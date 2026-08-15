import { describe, expect, it } from 'vitest';
import { payoutAccountSchema } from './payout-account';

/** A fresh row as the account.updated webhook first writes it: flags false, not yet onboarded. */
const freshRow = {
  id: '00000000-0000-0000-0000-00000000000a',
  profile_id: '11111111-1111-1111-1111-111111111111',
  stripe_account_id: 'acct_1PayoutTest',
  charges_enabled: false,
  payouts_enabled: false,
  onboarded_at: null,
  created_at: '2026-08-15T12:00:00+00:00',
  updated_at: '2026-08-15T12:00:00+00:00',
};

/** The same row once Stripe reports the account fully enabled. */
const onboardedRow = {
  ...freshRow,
  charges_enabled: true,
  payouts_enabled: true,
  onboarded_at: '2026-08-15T12:30:00+00:00',
};

const FLAGS = ['charges_enabled', 'payouts_enabled'] as const;

describe('payoutAccountSchema', () => {
  it('parses a fresh row unchanged (flags false, onboarded_at null)', () => {
    expect(payoutAccountSchema.parse(freshRow)).toEqual(freshRow);
  });

  it('parses an onboarded row unchanged', () => {
    expect(payoutAccountSchema.parse(onboardedRow)).toEqual(onboardedRow);
  });

  it('never coerces a capability flag — a truthy non-boolean throws instead of enabling payouts', () => {
    for (const flag of FLAGS) {
      for (const truthy of [1, 'true', 'yes']) {
        expect(() => payoutAccountSchema.parse({ ...freshRow, [flag]: truthy }), flag).toThrow();
      }
    }
  });

  it('throws on a null or absent flag — the columns are NOT NULL, so null is an upstream bug', () => {
    // Unlike the entitlements view (nullable, coalesced), these are table columns: a null
    // reaching the client means the query or the generated types broke, not "off".
    for (const flag of FLAGS) {
      expect(() => payoutAccountSchema.parse({ ...freshRow, [flag]: null }), flag).toThrow();
      const { [flag]: _dropped, ...withoutFlag } = freshRow;
      expect(() => payoutAccountSchema.parse(withoutFlag), flag).toThrow();
    }
  });

  it('rejects a blank or missing stripe_account_id — the row IS the pointer to Stripe', () => {
    expect(() => payoutAccountSchema.parse({ ...freshRow, stripe_account_id: '' })).toThrow();
    const { stripe_account_id: _dropped, ...withoutAccount } = freshRow;
    expect(() => payoutAccountSchema.parse(withoutAccount)).toThrow();
  });

  it('accepts onboarded_at null but not absent-by-type — a non-string non-null throws', () => {
    expect(payoutAccountSchema.parse(freshRow).onboarded_at).toBeNull();
    expect(() => payoutAccountSchema.parse({ ...freshRow, onboarded_at: 12345 })).toThrow();
  });

  it('rejects a non-uuid id or profile_id', () => {
    expect(() => payoutAccountSchema.parse({ ...freshRow, id: 'acct_1' })).toThrow();
    expect(() => payoutAccountSchema.parse({ ...freshRow, profile_id: 'me' })).toThrow();
  });
});
