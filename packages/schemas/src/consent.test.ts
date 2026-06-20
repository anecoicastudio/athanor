import { describe, expect, it } from 'vitest';
import { consentSchema, setConsentInput, CONSENT_KINDS } from './consent';

const validRow = {
  id: '11111111-1111-1111-1111-111111111111',
  profile_id: '22222222-2222-2222-2222-222222222222',
  kind: 'comms' as const,
  granted: true,
  granted_at: '2026-06-20T00:00:00Z',
  source: 'settings' as const,
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
};

describe('consentSchema', () => {
  it('parses a valid row', () => {
    expect(consentSchema.parse(validRow).kind).toBe('comms');
  });

  it('rejects an unknown kind (never_sold is constitutional, not a toggle)', () => {
    expect(() => consentSchema.parse({ ...validRow, kind: 'never_sold' })).toThrow();
  });

  it('lists exactly the three stored kinds', () => {
    expect(CONSENT_KINDS).toEqual(['comms', 'analytics', 'location_approx']);
  });

  it('setConsentInput picks only kind/granted/source', () => {
    expect(Object.keys(setConsentInput.parse(validRow)).sort()).toEqual([
      'granted',
      'kind',
      'source',
    ]);
  });
});
