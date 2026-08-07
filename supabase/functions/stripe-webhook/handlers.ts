import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { signQrToken } from '../_shared/qr.ts';

// Webhook processing extracted from index.ts so it is unit-testable (deno test):
// index.ts reads env / builds the Stripe + service-role singletons at import time and
// calls Deno.serve, which makes it un-importable in tests. Everything here takes its
// dependencies as parameters (repo convention: DI over mocks). Deliberately does NOT
// import ../_shared/stripe.ts — only type-level `npm:stripe` — so tests typecheck
// independently of the pinned-apiVersion/SDK-types drift in that module.

export type Db = SupabaseClient;

/**
 * Processing-lease window. A claim older than this with processed_at still NULL is
 * treated as a crashed isolate and may be re-claimed by a later Stripe retry.
 * Must comfortably exceed the edge-function wall clock (150s default).
 */
export const LEASE_MS = 10 * 60_000;

/** The I/O boundary handleWebhook needs — index.ts wires the real Stripe SDK calls. */
export type WebhookCtx = {
  db: Db;
  /** signs event-ticket QR payloads (deterministic per session) */
  qrSecret: string;
  /** stripe.webhooks.constructEventAsync bound to the endpoint secret; throws on bad signature */
  verifyEvent: (raw: string, sig: string) => Promise<Stripe.Event>;
  /** stripe.subscriptions.retrieve — only the W11 reconcile path calls Stripe outbound */
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
};

/** W1 — a paid ticket Checkout completed. Issue the ticket + sign the QR (service role). Idempotent. */
export async function handleTicketPaid(
  db: Db,
  qrSecret: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const eventId = session.metadata?.event_id;
  const profileId = session.metadata?.profile_id;
  if (!eventId || !profileId) throw new Error('ticket session missing metadata');

  // iat = session.created (deterministic) → a webhook retry re-issues the SAME token (no unique churn).
  const qrToken = await signQrToken(
    { eid: eventId, uid: profileId, iat: session.created },
    qrSecret,
  );

  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // The client has NO insert/update path — this upsert (service role) is the sole writer.
  // ignoreDuplicates: a redelivery (or a NEW Stripe event id for the same session, which the
  // processed_at gate can't catch) must NOT overwrite a later status — e.g. reset a Slice-B
  // `checked_in` ticket back to `paid`. The first W1 delivery already wrote paid + qr_token.
  const { error } = await db.from('event_tickets').upsert(
    {
      user_id: profileId,
      event_id: eventId,
      status: 'paid',
      stripe_payment_id: paymentIntent,
      qr_token: qrToken,
    },
    { onConflict: 'user_id,event_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/** W3 — a contribution Checkout completed. Write the contribution + recompute the aggregate (service role). Idempotent. */
export async function handleContribution(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  const editionId = session.metadata?.edition_id;
  if (!editionId) throw new Error('contribution session missing edition_id');
  // Stripe is the source of truth for the amount. Fail loud on a missing total so Stripe retries
  // (rather than relying on the amount_cents >= 100 CHECK to bounce a junk 0-row).
  if (!session.amount_total) throw new Error('contribution session missing amount_total');
  const profileId = session.metadata?.profile_id ?? null; // nullable: anonymous donors allowed

  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Row-level idempotency: stripe_checkout_session_id is UNIQUE → a redelivery is a no-op insert.
  const { error: insErr, count } = await db.from('fund_contributions').upsert(
    {
      edition_id: editionId,
      profile_id: profileId,
      amount_cents: session.amount_total,
      currency: (session.currency ?? 'eur').toLowerCase(),
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntent,
      status: 'succeeded',
    },
    { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true, count: 'exact' },
  );
  if (insErr) throw insErr;
  if (count === 0) return; // true duplicate delivery — the row already exists, aggregate already current

  // Recompute the live-ticker aggregate from source → Supabase Realtime publishes the change.
  const { error: aggErr } = await db.rpc('recompute_fund_aggregate', { p_edition_id: editionId });
  if (aggErr) throw aggErr;
}

/** W4 — a contribution charge refunded. Flip status + recompute. Match by payment_intent; ack if not found. */
export async function handleContributionRefunded(db: Db, charge: Stripe.Charge): Promise<void> {
  const paymentIntent =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);
  if (!paymentIntent) return; // nothing to match — ack (idempotency ledger already recorded it)

  const { data: rows, error: selErr } = await db
    .from('fund_contributions')
    .select('id,edition_id')
    .eq('stripe_payment_intent_id', paymentIntent)
    .eq('status', 'succeeded');
  if (selErr) throw selErr;
  if (!rows || rows.length === 0) return; // not a fund contribution (e.g. a ticket) — never error-loop

  const { error: updErr } = await db
    .from('fund_contributions')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', paymentIntent)
    .eq('status', 'succeeded'); // idempotency guard: a re-delivered refund won't re-flip
  if (updErr) throw updErr;

  const { error: aggErr } = await db.rpc('recompute_fund_aggregate', {
    p_edition_id: rows[0].edition_id,
  });
  if (aggErr) throw aggErr;
}

/** Map a Stripe subscription status to our circle_memberships enum. */
export function mapSubStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'incomplete':
      return 'incomplete';
    default:
      return 'canceled'; // canceled | unpaid | incomplete_expired | paused
  }
}

/** W5/W6/W7/W11 — upsert the membership cache from a Stripe subscription (service role). Idempotent. */
export async function handleSubscription(db: Db, sub: Stripe.Subscription): Promise<void> {
  const profileId = sub.metadata?.profile_id;
  if (!profileId) throw new Error('subscription missing profile_id metadata');

  const item = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval; // 'month' | 'year'
  const plan = interval === 'year' ? 'annual' : 'monthly';

  // current_period_end moved onto items in newer API versions; fall back to the subscription field.
  const periodEndUnix =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  // profile_id is UNIQUE → upsert keeps one membership per profile. founding_member is NOT touched here
  // (cosmetic; default false; award path is out of M8 scope).
  const { error } = await db.from('circle_memberships').upsert(
    {
      profile_id: profileId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      plan,
      status: mapSubStatus(sub.status),
      current_period_end: currentPeriodEnd,
    },
    { onConflict: 'profile_id' },
  );
  if (error) throw error;
}

/**
 * W9 — a Stripe Identity session verified. Cache the row (service role) and flip
 * profiles.identity_verified. Idempotent: upsert on stripe_session_id (UNIQUE). Does NOT write
 * aura_* (rule #1) — the +50 «Identity verified» is the M6 score-engine's job (07), wired when
 * the engine deploys (TODO(M6): engine reads this verified fact / a domain-event invocation).
 */
export async function handleIdentityVerified(
  db: Db,
  vs: Stripe.Identity.VerificationSession,
): Promise<void> {
  const profileId = vs.metadata?.profile_id;
  if (!profileId) throw new Error('verification session missing profile_id');

  const { error: vErr } = await db
    .from('verifications')
    .upsert(
      { profile_id: profileId, stripe_session_id: vs.id, status: 'verified' },
      { onConflict: 'stripe_session_id' },
    );
  if (vErr) throw vErr;

  const { error: pErr } = await db
    .from('profiles')
    .update({ identity_verified: true })
    .eq('id', profileId);
  if (pErr) throw pErr;
}

/**
 * W10 — a Stripe Identity session needs input or was canceled. Cache 'failed' so the UI offers
 * retry. No profile flag change. Idempotent via the stripe_session_id UNIQUE upsert.
 */
export async function handleIdentityFailed(
  db: Db,
  vs: Stripe.Identity.VerificationSession,
): Promise<void> {
  const profileId = vs.metadata?.profile_id;
  if (!profileId) throw new Error('verification session missing profile_id');
  const { error: vErr } = await db
    .from('verifications')
    .upsert(
      { profile_id: profileId, stripe_session_id: vs.id, status: 'failed' },
      { onConflict: 'stripe_session_id' },
    );
  if (vErr) throw vErr;
}

/** W8 — invoice.payment_failed → mark the cached membership past_due (dunning is Stripe's; app reflects). */
export async function handleInvoiceFailed(db: Db, invoice: Stripe.Invoice): Promise<void> {
  const subId =
    typeof (invoice as { subscription?: unknown }).subscription === 'string'
      ? ((invoice as { subscription?: string }).subscription as string)
      : ((invoice as { subscription?: { id?: string } }).subscription?.id ?? null);
  if (!subId) return; // not a subscription invoice — ack
  const { error } = await db
    .from('circle_memberships')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', subId);
  if (error) throw error;
}

export async function processEvent(
  ctx: Pick<WebhookCtx, 'db' | 'qrSecret' | 'retrieveSubscription'>,
  event: Stripe.Event,
): Promise<void> {
  const { db } = ctx;
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind === 'ticket') {
        await handleTicketPaid(db, ctx.qrSecret, session);
      } else if (session.metadata?.kind === 'contribution') {
        await handleContribution(db, session);
      } else if (session.metadata?.kind === 'subscription') {
        // W11 — reconcile: retrieve the subscription and upsert the full cache row (covers W5 lag).
        if (session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const sub = await ctx.retrieveSubscription(subId);
          await handleSubscription(db, sub);
        }
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // W5/W6/W7 — the deleted event carries status='canceled' already → mapSubStatus handles it.
      await handleSubscription(db, event.data.object as Stripe.Subscription);
      return;
    }
    case 'invoice.payment_failed': {
      // W8
      await handleInvoiceFailed(db, event.data.object as Stripe.Invoice);
      return;
    }
    case 'charge.refunded': {
      // W4: only fund contributions are handled here in M7 (ticket refunds = M8/W2).
      await handleContributionRefunded(db, event.data.object as Stripe.Charge);
      return;
    }
    case 'identity.verification_session.verified': {
      // W9
      await handleIdentityVerified(db, event.data.object as Stripe.Identity.VerificationSession);
      return;
    }
    case 'identity.verification_session.requires_input':
    case 'identity.verification_session.canceled': {
      // W10
      await handleIdentityFailed(db, event.data.object as Stripe.Identity.VerificationSession);
      return;
    }
    default:
      return; // unhandled types are acknowledged (200) so Stripe stops retrying.
  }
}

/** Full request pipeline: signature → idempotency ledger → atomic claim → process. */
export async function handleWebhook(ctx: WebhookCtx, req: Request): Promise<Response> {
  const { db } = ctx;
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });
  const raw = await req.text(); // RAW body — never req.json()

  // 1) SIGNATURE — async variant is mandatory in Deno (Web Crypto)
  let event: Stripe.Event;
  try {
    event = await ctx.verifyEvent(raw, sig);
  } catch {
    return new Response('bad signature', { status: 400 });
  }

  // 2) IDEMPOTENCY GATE — upsert the ledger row, branch on processed_at (00 §7 / 08 §4.1).
  // A failed ledger write breaks the dedupe guarantee (a later processed_at update would target a
  // missing row → Stripe retries reprocessing), so a ledger error must 500 and let Stripe retry.
  const { error: ledgerErr } = await db.from('stripe_webhook_events').upsert(
    {
      event_id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    },
    { onConflict: 'event_id', ignoreDuplicates: true },
  );
  if (ledgerErr) {
    console.error('ledger write failed', event.id, ledgerErr);
    return new Response('ledger error', { status: 500 });
  }
  // ATOMIC LEASE CLAIM — one conditional UPDATE decides the winner: processed_at must be
  // NULL (not done) and claimed_at NULL or stale (no live claim). Exactly one delivery per
  // lease window gets its row back. A hard crash inside processEvent leaves claimed_at stale
  // with processed_at NULL, so a Stripe retry after LEASE_MS re-claims and reprocesses
  // (at-least-once; per-handler UNIQUE constraints absorb replays).
  const leaseCutoff = new Date(Date.now() - LEASE_MS).toISOString();
  const ourClaim = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from('stripe_webhook_events')
    .update({ claimed_at: ourClaim })
    .eq('event_id', event.id)
    .is('processed_at', null)
    .or(`claimed_at.is.null,claimed_at.lt.${leaseCutoff}`)
    .select('event_id');
  if (claimErr) {
    console.error('ledger claim failed', event.id, claimErr);
    return new Response('ledger error', { status: 500 });
  }

  // Zero rows is ambiguous — either the event is DONE (true replay ⇒ ack) or someone else
  // holds a live lease (in flight, or a crashed isolate whose lease hasn't expired). Acking
  // the second case would consume Stripe's retry budget and silently drop the event, so we
  // disambiguate on processed_at and 409 the in-flight case: Stripe retries, and once the
  // lease expires the retry re-claims and reprocesses. THIS is what makes the lease
  // at-least-once — the column alone would only move the crash window.
  if (!claimed || claimed.length === 0) {
    const { data: row, error: readErr } = await db
      .from('stripe_webhook_events')
      .select('processed_at')
      .eq('event_id', event.id)
      .single();
    if (readErr) {
      console.error('ledger read failed', event.id, readErr);
      return new Response('ledger error', { status: 500 });
    }
    if (row?.processed_at) return new Response('already processed', { status: 200 });
    return new Response('claim held by another delivery', { status: 409 }); // retry after the lease
  }

  // 3) PROCESS — on failure, release OUR lease (claimed_at → NULL) and 500 so Stripe's retry
  // can re-claim immediately instead of waiting out the lease. The claimed_at equality guard
  // keeps a timed-out isolate from clearing a lease that a later delivery already re-claimed.
  try {
    await processEvent(ctx, event);
  } catch (e) {
    console.error('process failed', event.id, e);
    const { error: releaseErr } = await db
      .from('stripe_webhook_events')
      .update({ claimed_at: null })
      .eq('event_id', event.id)
      .eq('claimed_at', ourClaim);
    if (releaseErr)
      console.error('lease release failed — retry delayed one lease', event.id, releaseErr);
    return new Response('processing error', { status: 500 });
  }

  // 4) MARK PROCESSED — after successful processing, and only while we still hold the lease
  // (same guard: never stamp over another isolate's in-flight work). A failed stamp risks one
  // idempotent reprocess after the lease expires, so log it but still ack 200.
  const { error: markErr } = await db
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', event.id)
    .eq('claimed_at', ourClaim);
  if (markErr) console.error('mark processed failed', event.id, markErr);

  return new Response('ok', { status: 200 });
}
