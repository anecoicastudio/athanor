import { MIN_PAID_TICKET_CENTS } from '@athanor/schemas';

/**
 * The floor on a PAID ticket, in minor units (#701, ruling 2026-09-07): `0 or >= 500`. Free stays
 * legal — it is a band, not a minimum.
 *
 * RE-EXPORTED, not declared. The Zod band in `packages/schemas/src/event.ts` has to read it and
 * `schemas` is the dependency leaf (`core` imports `@athanor/schemas`, never the reverse), so the
 * declaration lives there and this module makes it reachable beside `DEFAULT_TICKET_FEE_PCT` —
 * the composer quotes both, and rule 10 wants the ticket-money constants in one place. The
 * `MIN_CONTRIBUTION_CENTS` re-export in `core/src/fund/amount.ts` is the same shape (#387).
 *
 * Why the floor exists: `ticketSplit` below hands Athanor `feePct` percent of the price, and out
 * of that come Stripe's processing (1,5% + €0,25 on a standard EEA card), the payout fee
 * (0,25% + €0,10) and €2 per active organiser-month. At the default ten percent those meet near
 * €4,24 a ticket; under the floor, selling a ticket costs the platform money.
 */
export { MIN_PAID_TICKET_CENTS };

/**
 * The default platform commission on a paid ticket, as a percentage of the displayed price.
 *
 * Mirrors the `default 10.00` on `events.fee_pct` (`20260615094844_events.sql`). The composer
 * quotes this figure to the organiser BEFORE an event row exists, so it cannot read the column;
 * `ticket-split.mirror.test.ts` is what keeps the two from drifting apart, together with the
 * Deno copy of `ticketSplit` in `create-ticket-checkout/logic.ts`.
 *
 * A live event prices from its OWN `fee_pct`, never from this constant — per-event rates are
 * possible in the data model even though nothing edits them yet.
 */
export const DEFAULT_TICKET_FEE_PCT = 10;

/**
 * The two figures a paid ticket splits into. `applicationFeeCents + organiserCents === priceCents`,
 * always and at every rate — the invariant the module exists to hold.
 */
export type TicketSplit = {
  /** what the buyer is charged: the displayed price, unchanged by the fee (the absorbed model) */
  priceCents: number;
  /** Stripe's `application_fee_amount` — what Athanor retains, and what it pays processing out of */
  applicationFeeCents: number;
  /** what the organiser's connected account keeps: the price less the fee, and nothing else */
  organiserCents: number;
};

/**
 * Split a ticket price into Athanor's commission and the organiser's share (#104, ruling
 * 2026-09-06 — the absorbed fee model).
 *
 * The buyer pays `priceCents`; no price shown anywhere in the app changes. Athanor retains
 * `feePct` percent of it as the destination charge's `application_fee_amount`.
 *
 * ## The organiser's share carries no processing term, deliberately
 *
 * On a destination charge the connected account is credited the FULL charge and the application
 * fee is transferred back to the platform, with Stripe's processing then debited from the
 * platform's balance — "Your platform pays the Stripe fee after the `application_fee_amount` is
 * transferred to your account" (docs.stripe.com/connect/destination-charges). The connected
 * accounts are built to match, with `controller.fees.payer: 'application'`. So the organiser
 * receives `price - fee` exactly, and any copy that promises "minus processing" is false. The
 * settlement disclosure (`event.create.settlement.*`) is written from this function, not from a
 * recollection of how marketplaces usually work.
 *
 * Athanor's own net is `applicationFeeCents` less Stripe's processing, which can go negative on a
 * cheap enough ticket. That is a pricing question, and #701 has since answered it with
 * `MIN_PAID_TICKET_CENTS` — but the answer is enforced by the schema, the `events_price_min`
 * CHECK and both write gates, never here. This function still computes the split it is asked for,
 * sub-floor prices included: it runs AFTER the seat claim, and a refusal at that point would
 * strand a held seat over a row the write path should never have admitted.
 *
 * ## Rounding and clamping
 *
 * `Math.round` to the nearest cent — the residue lands on whichever side is nearer, rather than
 * systematically on the organiser or on Athanor. The fee is then clamped into `[0, priceCents]`:
 * Stripe rejects an `application_fee_amount` above the charge total, and this function runs AFTER
 * the seat claim, so an out-of-range rate must degrade to a valid split rather than to a Session
 * that fails once a seat is already held. `fee_pct` is `numeric(5,2)`, so `feePct` is a real and
 * only the result is an integer.
 *
 * @throws RangeError on a price that is not a non-negative integer of minor units, or on a
 * non-finite rate. Money never enters this function as a float, and NaN must not leave it as one.
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
