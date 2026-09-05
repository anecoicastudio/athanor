import { describe, expect, it } from 'vitest';
import { MIN_MEMBER_AGE, isAtLeastAge } from './age';

/**
 * The 14+ floor (GDPR Art. 8, Italian floor — #694). The clock is INJECTED (core.md): a
 * function that reads today internally cannot be pinned at a boundary, and a birthday IS a
 * boundary. Fixed today: 5 September 2026, local time.
 */
const TODAY = new Date(2026, 8, 5);

describe('MIN_MEMBER_AGE', () => {
  it("is 14 — the migration’s guard (`interval '14 years'`) mirrors this, see min-age.mirror.test", () => {
    expect(MIN_MEMBER_AGE).toBe(14);
  });
});

describe('isAtLeastAge', () => {
  it('admits a member on their 14th birthday', () => {
    expect(isAtLeastAge('2012-09-05', 14, TODAY)).toBe(true);
  });

  it('refuses a member the day before their 14th birthday', () => {
    expect(isAtLeastAge('2012-09-06', 14, TODAY)).toBe(false);
  });

  it('admits a member the day after their 14th birthday', () => {
    expect(isAtLeastAge('2012-09-04', 14, TODAY)).toBe(true);
  });

  it('compares months before days: born a month later is still 13', () => {
    expect(isAtLeastAge('2012-10-05', 14, TODAY)).toBe(false);
    expect(isAtLeastAge('2012-08-05', 14, TODAY)).toBe(true);
  });

  it('compares years before months: born the previous December is 14, the next January is 13', () => {
    expect(isAtLeastAge('2011-12-31', 14, TODAY)).toBe(true);
    expect(isAtLeastAge('2013-01-01', 14, TODAY)).toBe(false);
  });

  it('turns N on 1 March in a non-leap year when born on 29 February', () => {
    const born = '2012-02-29';
    expect(isAtLeastAge(born, 14, new Date(2026, 1, 28))).toBe(false);
    expect(isAtLeastAge(born, 14, new Date(2026, 2, 1))).toBe(true);
  });

  it('turns N on 29 February itself in a leap year when born on 29 February', () => {
    expect(isAtLeastAge('2012-02-29', 16, new Date(2028, 1, 29))).toBe(true);
    expect(isAtLeastAge('2012-02-29', 16, new Date(2028, 1, 28))).toBe(false);
  });

  it('refuses a birth date in the future', () => {
    expect(isAtLeastAge('2030-01-01', 14, TODAY)).toBe(false);
  });

  it('refuses an unparseable date rather than admitting it', () => {
    expect(isAtLeastAge('x', 14, TODAY)).toBe(false);
    expect(isAtLeastAge('2023-02-29', 14, TODAY)).toBe(false);
  });

  it('honours the injected threshold: 0 years admits a birth today, 18 refuses the 14-year-old', () => {
    expect(isAtLeastAge('2026-09-05', 0, TODAY)).toBe(true);
    expect(isAtLeastAge('2012-09-05', 18, TODAY)).toBe(false);
  });

  it('reads today from LOCAL parts, not UTC — 23:30 on the 5th is still the 5th', () => {
    expect(isAtLeastAge('2012-09-05', 14, new Date(2026, 8, 5, 23, 30))).toBe(true);
  });
});
