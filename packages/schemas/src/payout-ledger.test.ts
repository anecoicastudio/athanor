import { describe, expect, it } from 'vitest';
import { payoutLedgerSchema } from './payout-ledger';

/** A row as the transfer.created webhook first records it: pool 10000, split 10 → payable 9000. */
const releasedRow = {
  id: '00000000-0000-0000-0000-00000000000a',
  edition_id: '00000000-0000-0000-0000-0000000000ed',
  destination_account_id: 'acct_1LedgerTest',
  amount_cents: 4000,
  reversed_cents: 0,
  currency: 'eur',
  pool_cents: 10000,
  split_pct: 10,
  payable_cents: 9000,
  status: 'released',
  stripe_transfer_id: 'tr_1LedgerTest',
  created_at: '2026-08-15T22:00:00+00:00',
  updated_at: '2026-08-15T22:00:00+00:00',
};

/** The same row after transfer.reversed returned everything. */
const reversedRow = { ...releasedRow, reversed_cents: 4000, status: 'reversed' };

describe('payoutLedgerSchema', () => {
  it('parses a released row unchanged', () => {
    expect(payoutLedgerSchema.parse(releasedRow)).toEqual(releasedRow);
  });

  it('parses a fully reversed row and a partial reversal (still released)', () => {
    expect(payoutLedgerSchema.parse(reversedRow)).toEqual(reversedRow);
    const partial = { ...releasedRow, reversed_cents: 1500 };
    expect(payoutLedgerSchema.parse(partial)).toEqual(partial);
  });

  it('rejects a payable that was not derived from the basis — never a chosen figure (#232)', () => {
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, payable_cents: 9001 })).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, payable_cents: 8999 })).toThrow();
    // The floor matters: pool 999 / split 10 → 899, not 900.
    const floored = {
      ...releasedRow,
      pool_cents: 999,
      payable_cents: 899,
      amount_cents: 800,
      reversed_cents: 0,
    };
    expect(payoutLedgerSchema.parse(floored)).toEqual(floored);
    expect(() => payoutLedgerSchema.parse({ ...floored, payable_cents: 900 })).toThrow();
  });

  it('rejects a reversal past the amount', () => {
    expect(() =>
      payoutLedgerSchema.parse({ ...releasedRow, reversed_cents: 4001, status: 'reversed' }),
    ).toThrow();
  });

  it('rejects an amount past the payable — no single transfer exceeds the cap', () => {
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, amount_cents: 9001 })).toThrow();
    const atPayable = { ...releasedRow, amount_cents: 9000 };
    expect(payoutLedgerSchema.parse(atPayable)).toEqual(atPayable);
  });

  it('rejects a status that contradicts the reversal arithmetic', () => {
    // fully reversed but still 'released' — and 'reversed' with money still out
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, reversed_cents: 4000 })).toThrow();
    expect(() =>
      payoutLedgerSchema.parse({ ...releasedRow, reversed_cents: 1500, status: 'reversed' }),
    ).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, status: 'reversed' })).toThrow();
  });

  it('rejects a zero or negative amount — a transfer moved money or it does not exist', () => {
    for (const amount of [0, -100]) {
      expect(() => payoutLedgerSchema.parse({ ...releasedRow, amount_cents: amount })).toThrow();
    }
  });

  it('rejects an out-of-range split and a negative pool', () => {
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, split_pct: 101 })).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, split_pct: -1 })).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, pool_cents: -1 })).toThrow();
  });

  it('rejects blank Stripe identifiers — the row IS the pointer to the transfer', () => {
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, stripe_transfer_id: '' })).toThrow();
    expect(() =>
      payoutLedgerSchema.parse({ ...releasedRow, destination_account_id: '' }),
    ).toThrow();
  });

  it('rejects a non-uuid id or edition_id and an unknown status', () => {
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, id: 'tr_1' })).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, edition_id: 'cycle-1' })).toThrow();
    expect(() => payoutLedgerSchema.parse({ ...releasedRow, status: 'pending' })).toThrow();
  });
});
