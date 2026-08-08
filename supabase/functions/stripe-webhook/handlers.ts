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

/**
 * Fail-closed settlement gate. Every payment method enabled on the account is an
 * immediate-notification method — card, Cartes Bancaires, Link, Apple/Google Pay, Bancontact,
 * EPS, and PayPal (Stripe permits only synchronous funding sources on PayPal unless you ask
 * Support to enable asynchronous ones). All of them carry the final outcome on
 * checkout.session.completed, so fulfilling there is safe.
 *
 * Delayed settlement is deliberately unsupported: no `pending` rows, no async_payment_*
 * promote/retire machinery. But nothing in this repo selects payment methods — the create-*
 * builders pass neither payment_method_types nor payment_method_configuration — so the Stripe
 * Dashboard's payment-method configuration is the ONLY control. If someone enables a
 * delayed-notification rail there (SEPA, ACH, Bacs, BECS, ACSS, Pay by Bank, BLIK, Boleto,
 * OXXO, Konbini, Multibanco, bank transfers), payment_status arrives 'unpaid' and this throws:
 * handleWebhook releases the lease and returns 500, Stripe retries, and the event stays in
 * stripe_webhook_events with processed_at NULL — a standing, queryable alarm. No QR is signed,
 * no money is counted, and the misconfiguration is loud.
 *
 * Loud has a deadline. Sustained 5xx makes Stripe disable the whole endpoint, and that stops
 * EVERY event type — including charge.refunded and charge.dispute.created, the only two paths
 * that pull money back out of the public Dream Fund ticker. A disabled endpoint therefore turns
 * this fail-closed guard into a silent over-count of a number members can see. Treat Stripe's
 * "endpoint disabled" mail as P0: fix the payment-method configuration and replay the backlog.
 *
 * Re-enabling a delayed method means restoring the state machine (git 0352e4c), not deleting
 * this function.
 */
export function assertSettled(session: Stripe.Checkout.Session): void {
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return;
  }
  throw new Error(
    `unsettled checkout session ${session.id} (payment_status=${session.payment_status}): a ` +
      'delayed-notification payment method is enabled on the Stripe account — nothing fulfilled',
  );
}

/** Stripe references are `"id"` when unexpanded and `{ id }` when expanded — normalise both. */
function refId(ref: unknown): string | null {
  if (typeof ref === 'string') return ref;
  return (ref as { id?: string } | null | undefined)?.id ?? null;
}

/** W1 — a ticket Checkout completed. Issue the ticket + sign the QR (service role). Idempotent. */
export async function handleTicketPaid(
  db: Db,
  qrSecret: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // A signed token is a door pass: never mint one for money that has not arrived. Throws
  // before any metadata read or write when a delayed method slipped onto the account.
  assertSettled(session);

  const eventId = session.metadata?.event_id;
  const profileId = session.metadata?.profile_id;
  if (!eventId || !profileId) throw new Error('ticket session missing metadata');

  // Deterministic per session: iat = session.created → every delivery re-signs the SAME token.
  const qrToken = await signQrToken(
    { eid: eventId, uid: profileId, iat: session.created },
    qrSecret,
  );

  // The client has NO insert/update path — this upsert (service role) is the sole writer.
  // ignoreDuplicates: a redelivery (or a NEW Stripe event id for the same session, which the
  // processed_at gate can't catch) must NOT overwrite a later status — e.g. reset a Slice-B
  // `checked_in` ticket back to `paid`. The first W1 delivery already wrote the row.
  const paymentIntent = refId(session.payment_intent);
  const { error, count } = await db.from('event_tickets').upsert(
    {
      user_id: profileId,
      event_id: eventId,
      status: 'paid',
      stripe_payment_id: paymentIntent,
      qr_token: qrToken,
    },
    { onConflict: 'user_id,event_id', ignoreDuplicates: true, count: 'exact' },
  );
  if (error) throw error;
  // count 0 = the unique(user_id,event_id) row already existed and the upsert was swallowed.
  // One real purchase hides among the redeliveries: a re-buy after a refund (the TicketBar
  // re-offers purchase on a refunded ticket) arrives with a NEW payment intent and would
  // otherwise be silently discarded — charged, no QR. Repair exactly that case; a null count
  // is indeterminate and falls through to "inserted" (worst case: today's swallow, no rewrite).
  if (count !== 0) return;
  // A repair without a PI would write a row revokeTicket can never match again. Unreachable
  // for mode:'payment' Checkout, but the swallow is the safe failure direction.
  if (!paymentIntent) return;

  const { data: existing, error: selErr } = await db
    .from('event_tickets')
    .select('status,stripe_payment_id')
    .eq('user_id', profileId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (selErr) throw selErr;
  const row = existing as { status?: string; stripe_payment_id?: string | null } | null;
  // Live (paid/checked_in) rows are untouchable — redelivery must never reset them. And a
  // replay of the ORIGINAL purchase session after its refund carries the SAME payment intent
  // as the refunded row: resurrecting it would undo the revocation, so only a different PI
  // (a genuinely new purchase) re-issues.
  if (!row || row.status !== 'refunded' || row.stripe_payment_id === paymentIntent) return;

  const { error: updErr } = await db
    .from('event_tickets')
    .update({ status: 'paid', stripe_payment_id: paymentIntent, qr_token: qrToken })
    .eq('user_id', profileId)
    .eq('event_id', eventId)
    .eq('status', 'refunded'); // guard: a concurrent status change wins over the repair
  if (updErr) throw updErr;
}

/** Recompute the live-ticker aggregate from source → Supabase Realtime publishes the change. */
async function recomputeAggregate(db: Db, editionId: string): Promise<void> {
  const { error } = await db.rpc('recompute_fund_aggregate', { p_edition_id: editionId });
  if (error) throw error;
}

/**
 * W3 — a contribution Checkout completed. Write the contribution (service role) and move the
 * live ticker. The ticker is public and realtime, so it must never show money that has not
 * arrived: assertSettled throws rather than writing a row the aggregate would have to
 * un-count later.
 *
 * Row-level idempotency: stripe_checkout_session_id is UNIQUE → a redelivery inserts nothing,
 * count comes back 0, and the aggregate is left alone because it is already current.
 */
export async function handleContribution(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  assertSettled(session);

  const editionId = session.metadata?.edition_id;
  if (!editionId) throw new Error('contribution session missing edition_id');
  // Stripe is the source of truth for the amount. Fail loud on a missing total so Stripe retries
  // (rather than relying on the amount_cents >= 100 CHECK to bounce a junk 0-row).
  if (!session.amount_total) throw new Error('contribution session missing amount_total');
  const profileId = session.metadata?.profile_id ?? null; // nullable: anonymous donors allowed

  const { error, count } = await db.from('fund_contributions').upsert(
    {
      edition_id: editionId,
      profile_id: profileId,
      amount_cents: session.amount_total,
      currency: (session.currency ?? 'eur').toLowerCase(),
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: refId(session.payment_intent),
      status: 'succeeded',
    },
    { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true, count: 'exact' },
  );
  if (error) throw error;
  // Skip the recompute only on a definite duplicate (count 0). A null count is indeterminate —
  // recompute anyway: the recompute is idempotent, an under-counted public ticker is not.
  if (count === 0) return;
  await recomputeAggregate(db, editionId);
}

/**
 * Pull a settled contribution back out of the ticker. Shared by W4 (refund) and W12 (dispute):
 * both mean the money is going away, and both must be idempotent under redelivery.
 * Matches by payment_intent; acks silently when the charge belongs to something else (a ticket).
 */
async function reverseContribution(db: Db, paymentIntentRef: unknown): Promise<void> {
  const paymentIntent = refId(paymentIntentRef);
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
    .eq('status', 'succeeded'); // idempotency guard: a re-delivered reversal won't re-flip
  if (updErr) throw updErr;

  await recomputeAggregate(db, (rows[0] as { edition_id: string }).edition_id);
}

/**
 * Revoke the event ticket bought by a charge that lost its money. The QR token is stateless
 * HMAC — there is no revocation list, so this status flip IS the revocation: check-in admits
 * only paid/checked_in, and the nulled qr_token stops the viewer rendering a door pass.
 * A single guarded update: no match (the charge was a contribution) or a re-delivered
 * reversal both no-op. Nothing to unwind besides access — paid tickets consume no capacity,
 * and attendance/aura are attendance-based by design.
 */
async function revokeTicket(db: Db, paymentIntentRef: unknown): Promise<void> {
  const paymentIntent = refId(paymentIntentRef);
  if (!paymentIntent) return; // nothing to match — ack (idempotency ledger already recorded it)

  const { error } = await db
    .from('event_tickets')
    .update({ status: 'refunded', qr_token: null })
    .eq('stripe_payment_id', paymentIntent)
    .in('status', ['paid', 'checked_in']); // guard: a re-delivered reversal won't re-flip
  if (error) throw error;
}

/**
 * W4 — a charge refunded. The payment intent belongs to exactly one of the two purchasable
 * things (a fund contribution or an event ticket), so both reversals run and at most one
 * matches. Match by payment_intent; ack if not found.
 */
export async function handleChargeRefunded(db: Db, charge: Stripe.Charge): Promise<void> {
  await reverseContribution(db, charge.payment_intent);
  await revokeTicket(db, charge.payment_intent);
}

/**
 * W12 — a charge disputed: a card chargeback, or a PayPal dispute/claim. Treat the money as
 * gone immediately; a won dispute is rare enough to reconcile by hand. Shares the reversal
 * pair with W4 — both mean the money is leaving, both must be idempotent.
 */
export async function handleDisputeCreated(db: Db, dispute: Stripe.Dispute): Promise<void> {
  await reverseContribution(db, dispute.payment_intent);
  await revokeTicket(db, dispute.payment_intent);
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

/**
 * W8 — invoice.payment_failed → mark the cached membership past_due (dunning is Stripe's; app reflects).
 *
 * 2025-03-31.basil moved `invoice.subscription` to `invoice.parent.subscription_details.subscription`,
 * and _shared/stripe.ts pins 2026-05-27.dahlia — so `parent` IS the live shape and the legacy
 * field is only a fallback for an endpoint still rendering a pre-Basil version. Reading the
 * legacy field alone silently acked every dunning event and no membership ever went past_due.
 */
export async function handleInvoiceFailed(db: Db, invoice: Stripe.Invoice): Promise<void> {
  const parentSub = (
    invoice as { parent?: { subscription_details?: { subscription?: unknown } } | null }
  ).parent?.subscription_details?.subscription;
  const subId = refId(parentSub) ?? refId((invoice as { subscription?: unknown }).subscription);
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
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      // Delayed settlement is not supported (see assertSettled). Reaching here means a
      // delayed-notification method is live on the Stripe account and the matching
      // checkout.session.completed already 500'd. Throw rather than fall through to the
      // `default` ack, so the second half of the misconfiguration is as loud as the first.
      throw new Error(
        `delayed-settlement event ${event.type} received — no handler by design; a ` +
          'delayed-notification payment method is enabled on the Stripe account',
      );
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
      // W4 — reverses whichever the charge bought: fund contribution or event ticket.
      await handleChargeRefunded(db, event.data.object as Stripe.Charge);
      return;
    }
    case 'charge.dispute.created': {
      // W12 — card chargeback / PayPal dispute. Same reversal pair as a refund.
      await handleDisputeCreated(db, event.data.object as Stripe.Dispute);
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
    const { data: released, error: releaseErr } = await db
      .from('stripe_webhook_events')
      .update({ claimed_at: null })
      .eq('event_id', event.id)
      .eq('claimed_at', ourClaim)
      .select('event_id');
    if (releaseErr)
      console.error('lease release failed — retry delayed one lease', event.id, releaseErr);
    else if (!released || released.length === 0)
      console.warn('lease already lost at release time', event.id);
    return new Response('processing error', { status: 500 });
  }

  // 4) MARK PROCESSED — after successful processing, and only while we still hold the lease
  // (same guard: never stamp over another isolate's in-flight work). Zero rows means our lease
  // expired mid-processing and someone re-claimed: that guarantees a duplicate reprocess, so it
  // must be visible in logs — PostgREST reports a no-op update as success, hence the .select().
  const { data: marked, error: markErr } = await db
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', event.id)
    .eq('claimed_at', ourClaim)
    .select('event_id');
  if (markErr) console.error('mark processed failed', event.id, markErr);
  else if (!marked || marked.length === 0)
    console.warn('lease lost before completion — event will be reprocessed', event.id);

  return new Response('ok', { status: 200 });
}
