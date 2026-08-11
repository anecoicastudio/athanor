import { describe, expect, it } from 'vitest';
import { entitlementsSchema } from './entitlements';

/** What the view returns for a profile with no membership row (left join, all coalesced false). */
const nonMemberRow = {
  profile_id: '00000000-0000-0000-0000-000000000002',
  is_member: false,
  plan: null,
  status: null,
  founding: false,
  advanced_filters: false,
  premium_events: false,
  analytics: false,
  market_reduced_fee: false,
};

/** What it returns for an active member: every Fase-1 bit true, the Fase-2 bit still false. */
const memberRow = {
  ...nonMemberRow,
  is_member: true,
  plan: 'annual',
  status: 'active',
  founding: true,
  advanced_filters: true,
  premium_events: true,
  analytics: true,
};

describe('entitlementsSchema', () => {
  it('parses a non-member row unchanged (null plan/status, every bit false)', () => {
    expect(entitlementsSchema.parse(nonMemberRow)).toEqual(nonMemberRow);
  });

  it('parses an active member row unchanged', () => {
    expect(entitlementsSchema.parse(memberRow)).toEqual(memberRow);
  });

  it('keeps market_reduced_fee false whether or not the profile is a member — PARKED(Fase-2)', () => {
    // The view hardcodes `false as market_reduced_fee` and pgTAP 0047 asserts that server-side.
    // Membership is what varies here: no plan or status may carry the Fase-2 bit along with it.
    expect(entitlementsSchema.parse(nonMemberRow).market_reduced_fee).toBe(false);
    expect(entitlementsSchema.parse(memberRow).market_reduced_fee).toBe(false);
  });

  it('never coerces a bit — a truthy non-boolean throws instead of reading as true', () => {
    for (const truthy of [1, 'true', 'yes']) {
      expect(() =>
        entitlementsSchema.parse({ ...nonMemberRow, market_reduced_fee: truthy }),
      ).toThrow();
      expect(() => entitlementsSchema.parse({ ...nonMemberRow, is_member: truthy })).toThrow();
    }
  });

  it('requires every feature bit — a row missing one does not parse', () => {
    for (const bit of [
      'is_member',
      'founding',
      'advanced_filters',
      'premium_events',
      'analytics',
      'market_reduced_fee',
    ] as const) {
      const { [bit]: _dropped, ...withoutBit } = memberRow;
      expect(() => entitlementsSchema.parse(withoutBit), bit).toThrow();
    }
  });

  it('accepts plan/status absent as well as null — the view left-joins', () => {
    const { plan: _p, status: _s, ...withoutMembership } = nonMemberRow;
    const e = entitlementsSchema.parse(withoutMembership);
    expect(e.plan).toBeUndefined();
    expect(e.status).toBeUndefined();
  });

  it('rejects a plan or status outside the Circle enums', () => {
    expect(() => entitlementsSchema.parse({ ...memberRow, plan: 'lifetime' })).toThrow();
    expect(() => entitlementsSchema.parse({ ...memberRow, status: 'trialing' })).toThrow();
  });

  it('rejects a non-uuid profile_id', () => {
    expect(() => entitlementsSchema.parse({ ...nonMemberRow, profile_id: 'me' })).toThrow();
  });
});
