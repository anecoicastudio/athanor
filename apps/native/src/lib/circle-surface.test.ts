import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { circleSurface } from './circle-surface';

/**
 * #761 — what a Circle-gated surface shows a person, decided once.
 *
 * Two rulings on the issue: on Android and web a non-member keeps the locked state, and while
 * `circle_checkout_enabled` is closed the lock says the membership is not open yet (09-19); on
 * iOS a non-member gets a neutral, non-tappable label and no route to the Circle screen (09-22).
 * Members are unlocked everywhere — the entitlement logic is untouched.
 */
describe('circleSurface — the truth table (#761)', () => {
  const checkouts = ['loading', 'open', 'closed'] as const;
  const oses = ['ios', 'android', 'web'] as const;

  it('a member is unlocked on every platform, whatever the checkout flag says', () => {
    for (const os of oses)
      for (const checkout of checkouts)
        expect(circleSurface({ member: true, os, checkout })).toBe('unlocked');
  });

  it('an iOS non-member gets the neutral label, whatever the checkout flag says', () => {
    for (const checkout of checkouts)
      expect(circleSurface({ member: false, os: 'ios', checkout })).toBe('reserved');
  });

  it('an Android or web non-member follows the checkout flag', () => {
    for (const os of ['android', 'web'] as const) {
      expect(circleSurface({ member: false, os, checkout: 'open' })).toBe('open');
      expect(circleSurface({ member: false, os, checkout: 'closed' })).toBe('closed');
      // The gate fails closed and has not answered yet: no line, no promise — the flag decides.
      expect(circleSurface({ member: false, os, checkout: 'loading' })).toBe('pending');
    }
  });
});

/**
 * The surfaces read the decision; none re-derives it. Read as text — the source-audit idiom
 * (`environment: 'node'`, nothing renderable is collectable).
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const read = (p: string) => readFileSync(`${SRC}${p}`, 'utf8');

describe('the Circle-gated surfaces consume the one decision (#761)', () => {
  const GATE = read('components/circle/CircleGate.tsx');
  const ROW = read('components/live/EventRow.tsx');
  const SETTINGS = read('app/(modal)/settings.tsx');
  const FILTERS = read('app/(modal)/search-filters.tsx');
  const HOOK = read('hooks/use-circle-surface.ts');

  it('the hook feeds the checkout gate and the platform into circleSurface', () => {
    expect(HOOK).toContain('useCircleCheckoutGate()');
    expect(HOOK).toContain('Platform.OS');
    expect(HOOK).toContain('circleSurface(');
  });

  it('every surface reads useCircleSurface and none checks the platform itself', () => {
    for (const src of [GATE, ROW, SETTINGS, FILTERS]) {
      expect(src).toContain('useCircleSurface(');
      expect(src).not.toContain('Platform.OS');
    }
  });

  it('CircleGate offers «Sblocca nel Circle» and a route only while checkout is open', () => {
    // The unlock copy is visible text in one arm only — the open one.
    expect(GATE.match(/t\('circle\.gate\.unlock', locale\)/g)?.length).toBe(1);
    expect(GATE).toContain("surface === 'open'");
    // The neutral label for iOS (and while the flag has not answered) is not a button.
    expect(GATE).toContain("t('circle.gate.reserved', locale)");
    // The closed arm says so, in the Circle screen's own words.
    expect(GATE).toContain("t('circle.checkoutClosed', locale)");
  });

  it('the event row adds the closed line and nothing else', () => {
    expect(ROW).toContain("surface === 'closed'");
    expect(ROW).toContain("t('circle.checkoutClosed', locale)");
    expect(ROW).not.toContain("'circle.gate.unlock'");
  });

  it('the Settings row is absent for an iOS non-member and says «not open yet» while closed', () => {
    expect(SETTINGS).toContain("circleRow !== 'reserved'");
    expect(SETTINGS).toContain("t('circle.checkoutClosed', locale)");
  });

  it('the filter sheet never routes an iOS non-member to the Circle screen', () => {
    expect(FILTERS).toContain("surface === 'reserved'");
    expect(FILTERS).toContain("'/(modal)/search'");
  });
});
