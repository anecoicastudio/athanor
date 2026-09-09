import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// Ticket-checkout construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// body parse, env + singleton wiring) and injects everything here (repo convention:
// DI over mocks). Deliberately does NOT import ../_shared/stripe.ts — only type-level
// `npm:stripe`: the Stripe capabilities arrive injected. #541 made that module lazy, so the
// import would no longer demand STRIPE_SECRET_KEY in a test env; the boundary stays because
// DI is the point.

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
  /** numeric(5,2) — PostgREST may hand it over as a number or as a string; coerce before use */
  fee_pct: number | string;
};

/**
 * The default platform commission, mirroring `default 10.00` on `events.fee_pct`.
 *
 * A live event always prices from its OWN column and never from this constant — it exists so the
 * mirror test has something to pin, and so the composer (which quotes the rate before an event row
 * exists) and this function cannot drift apart silently.
 *
 * DUPLICATED FROM `packages/core/src/events/ticket-split.ts`, along with the split arithmetic
 * below. `supabase/functions` is outside the pnpm workspace and cannot import `@athanor/core`; the
 * established answer is deliberate duplication plus a mirror test that reads both files as text
 * (`packages/core/src/events/ticket-split.mirror.test.ts`, the `fund/fees.ts` precedent). This copy
 * is the AUTHORITY — the server computes what Stripe is actually told; the app's figure is
 * disclosure only. Change one, change both.
 */
export const DEFAULT_TICKET_FEE_PCT = 10;

/**
 * The floor on a PAID ticket, in minor units (#701, ruling 2026-09-07). A band, not a minimum:
 * a free event is legal and never reaches this function at all — the `event is free` gate above
 * refuses it first.
 *
 * DUPLICATED FROM `packages/schemas/src/event.ts`, where `MIN_PAID_TICKET_CENTS` is declared and
 * where the Zod band reads it, and re-exported from `packages/core/src/events/ticket-split.ts`
 * for the composer. Same reason as `DEFAULT_TICKET_FEE_PCT` above: `supabase/functions` is outside
 * the pnpm workspace. The fourth home is the `events_price_min` CHECK
 * (`20260907145152_events_min_paid_ticket_price.sql`), and
 * `packages/core/src/events/ticket-split.mirror.test.ts` reads all four as text. Change one,
 * change all four.
 */
export const MIN_PAID_TICKET_CENTS = 500;

/** The two figures a paid ticket splits into. `applicationFeeCents + organiserCents === priceCents`. */
export type TicketSplit = {
  priceCents: number;
  applicationFeeCents: number;
  organiserCents: number;
};

/**
 * Split a ticket price into Athanor's commission and the organiser's share (#104).
 *
 * The organiser's share carries NO processing term: on a destination charge the connected account
 * is credited the full charge and the application fee is transferred back to the platform, with
 * Stripe's fee then debited from the platform's balance. The accounts are built to match, with
 * `controller.fees.payer: 'application'` in create-payout-onboarding.
 *
 * @throws RangeError on a price that is not a non-negative integer of minor units, or a non-finite
 * rate. Callers turn that into a 500 rather than letting NaN reach Stripe.
 */
export function ticketSplit({
  priceCents,
  feePct,
}: {
  priceCents: number;
  feePct: number;
}): TicketSplit {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new RangeError('priceCents must be a non-negative integer of minor units');
  }
  if (!Number.isFinite(feePct)) {
    throw new RangeError('feePct must be a finite percentage');
  }
  const applicationFeeCents = Math.min(
    Math.max(Math.round((priceCents * feePct) / 100), 0),
    priceCents,
  );
  return { priceCents, applicationFeeCents, organiserCents: priceCents - applicationFeeCents };
}

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
  destination: string,
): Stripe.Checkout.SessionCreateParams {
  const { applicationFeeCents } = ticketSplit({
    priceCents: event.price_cents,
    feePct: Number(event.fee_pct),
  });
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
    // #104 — the destination charge. The buyer is charged the displayed price unchanged (the
    // absorbed model); Stripe credits the organiser's connected account with the whole amount and
    // transfers the application fee back to the platform, which then pays the processing out of it.
    //
    // No `on_behalf_of`: it would make the organiser the settlement merchant, which requires a
    // payments capability these accounts deliberately never request (create-payout-onboarding asks
    // for `transfers` alone). Platform and organiser are both EU, so the cross-border rule that
    // would force it does not apply — revisit if a non-EU organiser is ever onboarded.
    payment_intent_data: {
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination },
    },
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
 * caller does not already hold a ticket (#116) → organizer has a payable connected
 * account (#104). Then builds the session; the buyer's
 * ticket is issued by the webhook (W1), not here.
 *
 * Every gate is server-side on purpose. The screen hides these buttons too, but this is a
 * public HTTP endpoint and verify_jwt only proves the caller is *a* member. The last three
 * gates must refuse BEFORE the Stripe call, because the charge is captured at hosted
 * Checkout and nothing downstream can decline it: the webhook's upsert is
 * ignoreDuplicates (correct, for redelivery), so a second purchase would be swallowed at
 * 200 with the money taken and no second ticket to show for it.
 *
 * The ticket gate is read-then-act, so it alone closes only the SEQUENTIAL re-buy — a
 * member who already holds a ticket. The concurrent double checkout (#258) is closed by
 * the claim below: a LIVE own pending claim returns 'claim_pending' → 409, no Session
 * minted. The claim (35 min) strictly outlives the Session it backs (30 min), so at most
 * one payable Session exists per (user, event) at any moment — the second charge cannot
 * come into existence, rather than being refunded after the fact.
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
    .select('id,title,price_cents,currency,fee_pct,organizer_id,starts_at,ends_at,deleted_at')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (evErr) return error('event lookup failed', 500);
  if (!event) return error('event not found', 404);
  if (!event.price_cents || event.price_cents <= 0) return error('event is free', 400);

  // #701 — the floor, immediately after the free gate because both are facts about the PRICE and
  // neither needs a lookup. The write paths (events_price_min, create_event, the insert trigger)
  // make a sub-floor paid row impossible to create, but this endpoint is public HTTP over rows it
  // did not write: a row that predates the CHECK, or one written by something that is not this
  // app, must refuse here rather than mint a Session whose fee cannot cover its own processing.
  // Before the seat claim, so refusing costs nobody a 35-minute hold.
  if (event.price_cents < MIN_PAID_TICKET_CENTS) {
    return error('ticket below minimum price', 400);
  }

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

  // #104 — the transfer destination. organizer_payout_destination is the DEFINER helper from
  // 20260906141227: this function runs on the BUYER's client and payout_accounts is select-own, so a
  // direct read returns zero rows, and an admin client here is asserted against in
  // _shared/auth-posture.test.ts — it "would silently read rows the caller cannot see and price a
  // Checkout session from them".
  //
  // Placed LAST of the read-only gates and still before claim_event_seat. Both halves matter. Above
  // the three gates before it, this refusal would mask theirs: a buyer whose local ticket cache is
  // stale would be told the organiser cannot be paid instead of 'ticket already owned', and
  // TicketBar's refetchTicket() — which exists to flip exactly that stale bar to the ticket view —
  // keys on the code and would never run. Below claim_event_seat, a revoked organiser's event would
  // hold a 35-minute seat on every attempt to buy.
  //
  // A null covers every miss uniformly (deleted, free, un-onboarded, capability revoked) and all of
  // them mean the same thing here. The creation gate makes this near-unreachable, but Stripe revokes
  // capabilities after the fact, so this is the arm that catches a revocation on an event that was
  // legitimately created. Fail-closed on lookup error: never sell when unsure.
  const { data: destination, error: destErr } = await userClient.rpc(
    'organizer_payout_destination',
    { p_event_id: eventId },
  );
  if (destErr) return error('payout destination lookup failed', 500);
  if (!destination) return error('organizer cannot receive payouts', 403);

  // #105 — claim the seat before the money moves (see the docblock). The RPC runs as the
  // caller (auth.uid()), so the claim can never be minted for someone else.
  const { data: claim, error: claimErr } = await userClient.rpc('claim_event_seat', {
    p_event_id: eventId,
  });
  if (claimErr) return error('seat claim failed', 500); // fail-closed: never sell when unsure
  if (claim === 'sold_out') return error('sold out', 409);
  // #258 — a live claim means a payable Session may already exist for this caller: minting
  // another would be the concurrent double charge. Not a payment failure — the copy says
  // "purchase in progress", and the claim's TTL bounds the wait after an abandoned Checkout.
  if (claim === 'claim_pending') return error('checkout already open', 409);
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
      buildTicketSessionParams(event, profileId, appBase, now().getTime(), destination),
    );
    if (!session.url) {
      await releaseSeat();
      return error('could not start checkout', 500);
    }
    return json({ url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the seat release and the generic 500 are unchanged, but the
    // Stripe reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-ticket-checkout: checkout.sessions.create', e);
    await releaseSeat();
    return error('could not start checkout', 500);
  }
}
