import type Stripe from 'npm:stripe';
import { cryptoProvider, stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { signQrToken } from '../_shared/qr.ts';

const whsec = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const qrSecret = Deno.env.get('QR_SIGNING_SECRET')!;
const db = supabaseAdmin(); // service role — the ONLY writer of money tables

type Db = ReturnType<typeof supabaseAdmin>;

/** W1 — a paid ticket Checkout completed. Issue the ticket + sign the QR (service role). Idempotent. */
async function handleTicketPaid(db: Db, session: Stripe.Checkout.Session): Promise<void> {
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

async function processEvent(db: Db, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind === 'ticket') {
        await handleTicketPaid(db, session);
      }
      // metadata.kind 'contribution' (M7) / 'subscription' (M8) → later slices.
      return;
    }
    // TODO(M8): case 'charge.refunded' → handleTicketRefunded (status='refunded'). Not in this slice.
    default:
      return; // unhandled types are acknowledged (200) so Stripe stops retrying.
  }
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });
  const raw = await req.text(); // RAW body — never req.json()

  // 1) SIGNATURE — async variant is mandatory in Deno (Web Crypto)
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whsec, undefined, cryptoProvider);
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
  const { data: row, error: readErr } = await db
    .from('stripe_webhook_events')
    .select('processed_at')
    .eq('event_id', event.id)
    .single();
  if (readErr) {
    console.error('ledger read failed', event.id, readErr);
    return new Response('ledger error', { status: 500 });
  }
  if (row?.processed_at) return new Response('already processed', { status: 200 }); // true replay

  // 3) PROCESS — leave processed_at NULL on failure so Stripe retries
  try {
    await processEvent(db, event);
  } catch (e) {
    console.error('process failed', event.id, e);
    return new Response('processing error', { status: 500 });
  }

  // 4) MARK PROCESSED — a failed mark just risks one idempotent reprocess on a future redelivery,
  // so log it but still ack 200 (the ticket was already issued idempotently).
  const { error: markErr } = await db
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', event.id);
  if (markErr) console.error('mark processed failed', event.id, markErr);

  return new Response('ok', { status: 200 });
});
