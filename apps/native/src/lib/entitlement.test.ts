import { describe, expect, it } from 'vitest';
import type { Entitlements } from '@athanor/schemas';
import { toEntitlementView } from './entitlement';

const row = (patch: Partial<Entitlements> = {}): Entitlements =>
  ({
    profile_id: '33333333-3333-4333-8333-333333333333',
    is_member: true,
    plan: 'annual',
    status: 'active',
    founding: true,
    advanced_filters: true,
    premium_events: true,
    analytics: true,
    market_reduced_fee: true,
    ...patch,
  }) as Entitlements;

describe('toEntitlementView — no row means no access', () => {
  it('null denies membership and every feature', () => {
    expect(toEntitlementView(null)).toEqual({
      isMember: false,
      plan: null,
      status: null,
      founding: false,
      features: {
        advancedFilters: false,
        premiumEvents: false,
        analytics: false,
        marketReducedFee: false,
      },
    });
  });

  it('undefined behaves identically to null', () => {
    expect(toEntitlementView(undefined)).toEqual(toEntitlementView(null));
  });
});

describe('toEntitlementView — a full row maps across', () => {
  it('carries membership, plan, status and founding', () => {
    const view = toEntitlementView(row());
    expect(view.isMember).toBe(true);
    expect(view.plan).toBe('annual');
    expect(view.status).toBe('active');
    expect(view.founding).toBe(true);
  });

  it('renames every feature column to its camelCase flag', () => {
    expect(toEntitlementView(row()).features).toEqual({
      advancedFilters: true,
      premiumEvents: true,
      analytics: true,
      marketReducedFee: true,
    });
  });

  it('carries a monthly plan too', () => {
    expect(toEntitlementView(row({ plan: 'monthly' })).plan).toBe('monthly');
  });

  it('carries every lapsed status verbatim', () => {
    for (const status of ['active', 'past_due', 'canceled', 'incomplete'] as const) {
      expect(toEntitlementView(row({ status })).status).toBe(status);
    }
  });
});

describe('toEntitlementView — nullish columns fail closed, never open', () => {
  it('a null plan/status become null rather than leaking undefined', () => {
    const view = toEntitlementView(row({ plan: null, status: null }));
    expect(view.plan).toBeNull();
    expect(view.status).toBeNull();
  });

  it('each feature defaults to false on its own when the column is absent', () => {
    const view = toEntitlementView(
      row({
        advanced_filters: undefined,
        premium_events: undefined,
        analytics: undefined,
        market_reduced_fee: undefined,
      } as Partial<Entitlements>),
    );
    expect(view.features).toEqual({
      advancedFilters: false,
      premiumEvents: false,
      analytics: false,
      marketReducedFee: false,
    });
  });

  it('an absent is_member/founding denies rather than assumes', () => {
    const view = toEntitlementView(
      row({ is_member: undefined, founding: undefined } as Partial<Entitlements>),
    );
    expect(view.isMember).toBe(false);
    expect(view.founding).toBe(false);
  });

  it('a false column stays false — the ?? default never overrides an explicit no', () => {
    const view = toEntitlementView(row({ is_member: false, advanced_filters: false }));
    expect(view.isMember).toBe(false);
    expect(view.features.advancedFilters).toBe(false);
  });

  it('membership and the feature bits are independent — a member can still lack a feature', () => {
    const view = toEntitlementView(row({ is_member: true, advanced_filters: false }));
    expect(view.isMember).toBe(true);
    expect(view.features.advancedFilters).toBe(false);
  });

  it('every flag is a real boolean, never a truthy passthrough', () => {
    const view = toEntitlementView(row());
    for (const flag of Object.values(view.features)) expect(typeof flag).toBe('boolean');
    expect(typeof view.isMember).toBe('boolean');
    expect(typeof view.founding).toBe('boolean');
  });
});
