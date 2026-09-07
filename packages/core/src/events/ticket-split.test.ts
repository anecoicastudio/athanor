import { describe, expect, it } from 'vitest';
import { DEFAULT_TICKET_FEE_PCT, MIN_PAID_TICKET_CENTS, ticketSplit } from './ticket-split';

/**
 * #104 — the absorbed-fee split for a paid ticket, decided by the 2026-09-06 ruling.
 *
 * The buyer pays the displayed `price_cents`. Athanor retains `events.fee_pct` percent of it as
 * Stripe's `application_fee_amount`; the organiser receives the rest. On a DESTINATION charge the
 * connected account is credited the full amount and the application fee is transferred back to the
 * platform, so the organiser's figure is `price - fee` EXACTLY — Stripe's processing is debited
 * from the PLATFORM's balance, never the organiser's. That is why there is no processing term in
 * this module, and why the settlement copy may not name one.
 *
 * Source, read rather than recalled (docs.stripe.com/connect/destination-charges): "Your platform
 * pays the Stripe fee after the `application_fee_amount` is transferred to your account." The
 * connected accounts agree — `create-payout-onboarding/logic.ts` builds them with
 * `controller.fees.payer: 'application'`.
 *
 * Integer minor units throughout: a cents value must never reach a payment boundary carrying a
 * binary-fraction artifact (the `fund/fees.ts` argument). `fee_pct` itself is NOT an integer —
 * the column is `numeric(5,2)` — so the percentage is a real and only the result is rounded.
 */
describe('ticketSplit', () => {
  it('keeps fee_pct percent of the price as the application fee', () => {
    expect(ticketSplit({ priceCents: 1500, feePct: 10 })).toEqual({
      priceCents: 1500,
      applicationFeeCents: 150,
      organiserCents: 1350,
    });
  });

  it('accepts a fractional fee_pct, because the column is numeric(5,2)', () => {
    // 2000 * 7.5% = 150 exactly. A guard that demanded an integer pct would refuse a legal row.
    expect(ticketSplit({ priceCents: 2000, feePct: 7.5 })).toEqual({
      priceCents: 2000,
      applicationFeeCents: 150,
      organiserCents: 1850,
    });
  });

  it('rounds the fee to the nearest cent rather than down', () => {
    // 105 * 10% = 10.5 → round 11, floor 10. Distinguishes Math.round from Math.floor.
    expect(ticketSplit({ priceCents: 105, feePct: 10 }).applicationFeeCents).toBe(11);
  });

  it('rounds the fee to the nearest cent rather than up', () => {
    // 104 * 10% = 10.4 → round 10, ceil 11. Distinguishes Math.round from Math.ceil.
    expect(ticketSplit({ priceCents: 104, feePct: 10 }).applicationFeeCents).toBe(10);
  });

  it('takes nothing at 0 percent', () => {
    expect(ticketSplit({ priceCents: 1500, feePct: 0 })).toEqual({
      priceCents: 1500,
      applicationFeeCents: 0,
      organiserCents: 1500,
    });
  });

  it('takes the whole price at 100 percent', () => {
    expect(ticketSplit({ priceCents: 1500, feePct: 100 })).toEqual({
      priceCents: 1500,
      applicationFeeCents: 1500,
      organiserCents: 0,
    });
  });

  it('clamps a fee above the price to the price, never leaving the organiser negative', () => {
    // Stripe caps `application_fee_amount` at the charge total and rejects anything larger, so an
    // out-of-range fee_pct must degrade to "Athanor takes all of it" rather than to a failed
    // Session minted after the seat was claimed. The DB CHECK bounds fee_pct to 0..100; this is
    // the belt, because the value also reaches this function from the composer's default.
    const split = ticketSplit({ priceCents: 1000, feePct: 250 });
    expect(split.applicationFeeCents).toBe(1000);
    expect(split.organiserCents).toBe(0);
  });

  it('clamps a negative fee_pct to zero, never paying the organiser more than the price', () => {
    const split = ticketSplit({ priceCents: 1000, feePct: -10 });
    expect(split.applicationFeeCents).toBe(0);
    expect(split.organiserCents).toBe(1000);
  });

  it('splits a zero price into two zeroes', () => {
    // A free event never reaches Stripe, but the function must not be the thing that decides that.
    expect(ticketSplit({ priceCents: 0, feePct: 10 })).toEqual({
      priceCents: 0,
      applicationFeeCents: 0,
      organiserCents: 0,
    });
  });

  it('the two halves always add back to the price', () => {
    // The invariant the module exists to hold: money is conserved at every price and every pct.
    for (let priceCents = 0; priceCents <= 5000; priceCents += 7) {
      for (const feePct of [0, 1, 7.5, 10, 33.33, 50, 99.99, 100]) {
        const s = ticketSplit({ priceCents, feePct });
        expect(s.applicationFeeCents + s.organiserCents, `${priceCents}@${feePct}`).toBe(
          priceCents,
        );
        expect(s.applicationFeeCents, `${priceCents}@${feePct}`).toBeGreaterThanOrEqual(0);
        expect(s.organiserCents, `${priceCents}@${feePct}`).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(s.applicationFeeCents), `${priceCents}@${feePct}`).toBe(true);
        expect(Number.isInteger(s.organiserCents), `${priceCents}@${feePct}`).toBe(true);
      }
    }
  });

  it('refuses a non-integer price', () => {
    expect(() => ticketSplit({ priceCents: 10.5, feePct: 10 })).toThrow(RangeError);
  });

  it('refuses a negative price', () => {
    expect(() => ticketSplit({ priceCents: -1, feePct: 10 })).toThrow(RangeError);
  });

  it('refuses a non-finite price', () => {
    expect(() => ticketSplit({ priceCents: Number.POSITIVE_INFINITY, feePct: 10 })).toThrow(
      RangeError,
    );
  });

  it('refuses a non-finite fee_pct', () => {
    expect(() => ticketSplit({ priceCents: 1000, feePct: Number.NaN })).toThrow(RangeError);
  });

  it('DEFAULT_TICKET_FEE_PCT is the ten percent the ruling fixed', () => {
    // The composer quotes this number before an event row exists, so it cannot read `fee_pct`.
    // `ticket-split.mirror.test.ts` pins it against the column default and against the Deno copy.
    expect(DEFAULT_TICKET_FEE_PCT).toBe(10);
  });

  // #701, ruling 2026-09-07 — the second ticket-money constant, reachable from the same module as
  // the first so the composer imports both from `@athanor/core`. DECLARED in `@athanor/schemas`
  // (the Zod band has to read it and `schemas` is the dependency leaf); re-exported here. The
  // mirror test pins the value across all four homes.
  it('MIN_PAID_TICKET_CENTS is re-exported here, at the ruled €5,00', () => {
    expect(MIN_PAID_TICKET_CENTS).toBe(500);
  });

  // The floor is a pricing decision, not this function's — stated in the docblock, asserted here
  // so the claim cannot rot into a silent guard. A sub-floor price still splits correctly; what
  // refuses it is the schema, the CHECK and the two write gates, none of them this.
  it('splits a sub-floor price anyway — the floor is not enforced here', () => {
    expect(ticketSplit({ priceCents: 300, feePct: DEFAULT_TICKET_FEE_PCT })).toEqual({
      priceCents: 300,
      applicationFeeCents: 30,
      organiserCents: 270,
    });
  });
});
