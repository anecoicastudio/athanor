import { describe, expect, it } from 'vitest';
import { PLAN_REFUSALS } from '@athanor/api';
import { planRefusalKey } from './plan-refusal';

describe('planRefusalKey', () => {
  it('names the ceiling refusal as its own thing, never as a failed save', () => {
    expect(planRefusalKey({ message: 'phases exceed declared payable' })).toBe(
      'fund.plan.error.ceiling',
    );
  });

  it('maps the publication ladder to its own lines', () => {
    expect(planRefusalKey({ message: 'plan has no phases' })).toBe('fund.plan.error.noPhases');
    expect(planRefusalKey({ message: 'publication out of phase' })).toBe(
      'fund.plan.error.outOfPhase',
    );
    expect(planRefusalKey({ message: 'plan already published' })).toBe(
      'fund.plan.error.alreadyPublished',
    );
    expect(planRefusalKey({ message: 'not the plan author' })).toBe('fund.plan.error.notAuthor');
    expect(planRefusalKey({ message: 'viability not confirmed' })).toBe(
      'fund.plan.error.notConfirmed',
    );
  });

  it('degrades anything unnamed to the generic line rather than showing a raw error', () => {
    expect(planRefusalKey(new Error('Network request failed'))).toBe('fund.plan.error.generic');
    expect(planRefusalKey({ message: 'permission denied for table realization_plans' })).toBe(
      'fund.plan.error.generic',
    );
    expect(planRefusalKey(null)).toBe('fund.plan.error.generic');
  });

  it('has a key for every refusal the server can raise', () => {
    for (const refusal of PLAN_REFUSALS) {
      expect(planRefusalKey({ message: refusal })).toMatch(/^fund\.plan\.error\./);
    }
  });
});
