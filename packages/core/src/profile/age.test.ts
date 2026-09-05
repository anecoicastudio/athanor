import { describe, expect, it } from 'vitest';
import { MIN_MEMBER_AGE, isAtLeastAge } from './age';

/**
 * The 14+ floor (GDPR Art. 8, Italian floor — #694). The clock is INJECTED (core.md): a
 * function that reads today internally cannot be pinned at a boundary, and a birthday IS a
 * boundary. Fixed today: 5 September 2026 at noon UTC — the function reads UTC parts, the
 * same calendar the DB trigger uses, so every instant below is built with Date.UTC.
 */
const utc = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const TODAY = utc(2026, 9, 5);

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
    expect(isAtLeastAge(born, 14, utc(2026, 2, 28))).toBe(false);
    expect(isAtLeastAge(born, 14, utc(2026, 3, 1))).toBe(true);
  });

  it('turns N on 29 February itself in a leap year when born on 29 February', () => {
    expect(isAtLeastAge('2012-02-29', 16, utc(2028, 2, 29))).toBe(true);
    expect(isAtLeastAge('2012-02-29', 16, utc(2028, 2, 28))).toBe(false);
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

  it('reads today in UTC, the calendar the DB trigger uses — 23:30Z on the 5th is still the 5th', () => {
    expect(isAtLeastAge('2012-09-05', 14, utc(2026, 9, 5, 23, 30))).toBe(true);
  });

  it('is never more permissive than the trigger: 00:30 CEST on the birthday is still yesterday in UTC', () => {
    // 2026-09-05T22:30Z is 00:30 on 6 September in Rome. A member born 2012-09-06 is 14 on
    // their wall clock, but the trigger's `(now() at time zone 'utc')::date` says 5 September
    // — so this must refuse, or the flush fails with a 23514 the screen cannot explain.
    expect(isAtLeastAge('2012-09-06', 14, utc(2026, 9, 5, 22, 30))).toBe(false);
    // …and one UTC-day later it admits, on both clocks.
    expect(isAtLeastAge('2012-09-06', 14, utc(2026, 9, 6, 0, 30))).toBe(true);
  });
});
