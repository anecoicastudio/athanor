import { describe, expect, it } from 'vitest';
import { consentSchema, setConsentInput, CONSENT_KINDS } from './consent.ts';

const validRow = {
  id: '11111111-1111-1111-1111-111111111111',
  profile_id: '22222222-2222-2222-2222-222222222222',
  kind: 'analytics' as const,
  granted: true,
  granted_at: '2026-06-20T00:00:00Z',
  source: 'settings' as const,
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
};

describe('consentSchema', () => {
  it('parses a valid row', () => {
    expect(consentSchema.parse(validRow).kind).toBe('analytics');
  });

  it('rejects an unknown kind (never_sold is constitutional, not a toggle)', () => {
    expect(() => consentSchema.parse({ ...validRow, kind: 'never_sold' })).toThrow();
  });

  it('rejects the retired comms kind (#841: the switch is gone, the rows are purged)', () => {
    expect(() => consentSchema.parse({ ...validRow, kind: 'comms' })).toThrow();
  });

  it('lists exactly the two stored kinds', () => {
    expect(CONSENT_KINDS).toEqual(['analytics', 'location_approx']);
  });

  it('setConsentInput picks only kind/granted/source', () => {
    expect(Object.keys(setConsentInput.parse(validRow)).sort()).toEqual([
      'granted',
      'kind',
      'source',
    ]);
  });
});
