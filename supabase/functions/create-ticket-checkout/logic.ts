import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

// Ticket-checkout construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// body parse, env + singleton wiring) and injects everything here (repo convention:
// DI over mocks). Deliberately does NOT import ../_shared/stripe.ts — only type-level
// `npm:stripe` — so tests typecheck without STRIPE_SECRET_KEY in the env.

export type TicketCheckoutCtx = {
  /** the caller's own client — RLS lets any member read a published event */
  userClient: SupabaseClient;
  /** stripe.checkout.sessions.create — the only outbound Stripe call */
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
  ) => Promise<Stripe.Checkout.Session>;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
  /** injected clock — the past-event guard is time-dependent (core rule: no bare Date) */
  now: () => Date;
};

export type TicketCheckoutInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  eventId: string;
};

/** The event columns the session is priced from. */
export type TicketEvent = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
};

/**
 * Pure params builder. The price comes from the EVENT ROW (never client-supplied);
 * metadata.kind routes the shared webhook (W1); profile_id is the verified caller.
 * `nowMs` (injected clock) caps the Session at 30 minutes — Stripe's minimum expiry —
 * so the 35-minute seat claim (#105, claim_event_seat) strictly outlives the Session
 * it backs: a payment that can still complete always has an unexpired claim behind it.
 */
export function buildTicketSessionParams(
  event: TicketEvent,
  profileId: string,
  appBase: string,
  nowMs: number,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    expires_at: Math.floor(nowMs / 1000) + 30 * 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: event.currency, // lowercase ISO (e.g. 'eur'); Stripe accepts lowercase
          unit_amount: event.price_cents,
          product_data: { name: event.title },
        },
      },
    ],
    // Webhook routing (W1) keys on metadata.kind. profile_id is the verified caller, never the body.
    metadata: { kind: 'ticket', event_id: event.id, profile_id: profileId },
    success_url: `${appBase}event/${event.id}?checkout=success`,
    cancel_url: `${appBase}event/${event.id}?checkout=cancel`,
  };
}

/**
 * Gates in order: event exists & not deleted → priced (free events never reach Stripe) →
 * organizer identity-verified (P2.4, 08 §3.1 — fail-closed on lookup error; never sell
 * for an unverifiable organizer) → caller is not the organizer → event has not ended →
 * caller does not already hold a ticket (#116). Then builds the session; the buyer's
 * ticket is issued by the webhook (W1), not here.
 *
 * Every gate is server-side on purpose. The screen hides these buttons too, but this is a
 * public HTTP endpoint and verify_jwt only proves the caller is *a* member. The last three
 * gates must refuse BEFORE the Stripe call, because the charge is captured at hosted
 * Checkout and nothing downstream can decline it: the webhook's upsert is
 * ignoreDuplicates (correct, for redelivery), so a second purchase would be swallowed at
 * 200 with the money taken and no second ticket to show for it.
 *
 * The ticket gate is read-then-act, so it closes the SEQUENTIAL re-buy — a member who
 * already holds a ticket — and not the concurrent one: a same-user concurrent double
 * checkout is #258, and the claim row below is the mechanism it will build on (an own
 * re-claim is currently idempotent on purpose — refusing it is #258's decision to make).
 *
 * Capacity (#105) is the last gate and the only one that is NOT read-then-act: the
 * claim_event_seat RPC locks the events row, counts held seats (paid, checked_in,
 * unexpired pending) and writes this caller's pending claim in one transaction, BEFORE
 * any money moves. Concurrent buyers serialize on that lock — the count this function
 * could run itself would be a race (two checkouts both pass, both charge, no way to
 * decline the second after hosted Checkout captures it).
 */
export async function createTicketCheckout(
  ctx: TicketCheckoutCtx,
  input: TicketCheckoutInput,
): Promise<Response> {
  const { userClient, createCheckoutSession, appBase, now } = ctx;
  const { profileId, eventId } = input;

  // Load the event server-side (RLS lets any member read a published event).
  const { data: event, error: evErr } = await userClient
    .from('events')
    .select('id,title,price_cents,currency,organizer_id,starts_at,ends_at,deleted_at')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (evErr) return error('event lookup failed', 500);
  if (!event) return error('event not found', 404);
  if (!event.price_cents || event.price_cents <= 0) return error('event is free', 400);

  // P2.4 — organizer must be identity_verified before selling tickets (08 §3.1).
  // is_identity_verified is the DEFINER helper from m7_candidacy (reads the column without
  // exposing it cross-RLS); fail-closed on lookup error — never sell for an unverifiable organizer.
  const { data: organizerVerified, error: verErr } = await userClient.rpc('is_identity_verified', {
    uid: event.organizer_id,
  });
  if (verErr) return error('organizer verification lookup failed', 500);
  if (!organizerVerified) return error('organizer not verified', 403);

  // The organizer cannot buy a ticket to their own event. The screen knows this
  // (isOrganizer) and never passed it on; decided here from the verified caller.
  if (event.organizer_id === profileId) return error('organizer cannot buy', 403);

  // Past events are refused, not merely hidden: the screen swaps the action bar for a stub,
  // which is layout, not authorization. ends_at when set, otherwise starts_at — the same
  // rule the screen uses, so an event under way keeps selling.
  const endsAt = new Date(event.ends_at ?? event.starts_at).getTime();
  if (endsAt < now().getTime()) return error('event ended', 410);

  // A held ticket makes a second charge money for nothing (unique (user_id, event_id) plus the
  // webhook's ignoreDuplicates upsert), so refuse here. 'refunded' must pass: the webhook's
  // repair path re-issues on a new payment intent. 'pending' was never paid, so nothing is owned.
  // Own row only — event_tickets_select_own is the RLS policy this rides on.
  const { data: ticket, error: tErr } = await userClient
    .from('event_tickets')
    .select('status')
    .eq('user_id', profileId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (tErr) return error('ticket lookup failed', 500); // fail-closed: never sell when unsure
  if (ticket?.status === 'paid' || ticket?.status === 'checked_in') {
    return error('ticket already owned', 409);
  }

  // #105 — claim the seat before the money moves (see the docblock). The RPC runs as the
  // caller (auth.uid()), so the claim can never be minted for someone else.
  const { data: claim, error: claimErr } = await userClient.rpc('claim_event_seat', {
    p_event_id: eventId,
  });
  if (claimErr) return error('seat claim failed', 500); // fail-closed: never sell when unsure
  if (claim === 'sold_out') return error('sold out', 409);
  if (claim === 'already_owned') return error('ticket already owned', 409); // belt for the gate above
  if (claim === 'not_found') return error('event not found', 404);
  if (claim !== 'claimed') return error('seat claim failed', 500); // unknown verdict — fail-closed

  // Wrap the Stripe call: an API error must return a clean {error} (never leak Stripe's raw
  // error body / a 500 with internals). No charge has happened, so failing here is money-safe —
  // but a seat IS held now, so release it (best-effort; the claim's 35-minute TTL is the backstop).
  const releaseSeat = () =>
    userClient.rpc('release_event_seat', { p_event_id: eventId }).then(
      () => undefined,
      () => undefined,
    );
  try {
    const session = await createCheckoutSession(
      buildTicketSessionParams(event, profileId, appBase, now().getTime()),
    );
    if (!session.url) {
      await releaseSeat();
      return error('could not start checkout', 500);
    }
    return json({ url: session.url });
  } catch {
    await releaseSeat();
    return error('could not start checkout', 500);
  }
}
