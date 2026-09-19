import { describe, expect, it } from 'vitest';
import { MIN_MEMBER_AGE, isAtLeastAge } from './age';

/**
 * The 18+ floor — adults only for the first release (#778, reversing #694's 14 for launch). The
 * clock is INJECTED (core.md): a function that reads today internally cannot be pinned at a
 * boundary, and a birthday IS a boundary. Fixed today: 5 September 2026 at noon UTC — the
 * function reads UTC parts, the same calendar the DB trigger uses, so every instant below is
 * built with Date.UTC.
 */
const utc = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const TODAY = utc(2026, 9, 5);

describe('MIN_MEMBER_AGE', () => {
  it("is 18 — the migration’s guard (`interval '18 years'`) mirrors this, see min-age.mirror.test", () => {
    expect(MIN_MEMBER_AGE).toBe(18);
  });

  it('is the floor the funnel applies: admitted on the 18th birthday, refused the day before', () => {
    expect(isAtLeastAge('2008-09-05', MIN_MEMBER_AGE, TODAY)).toBe(true);
    expect(isAtLeastAge('2008-09-06', MIN_MEMBER_AGE, TODAY)).toBe(false);
  });
});

describe('isAtLeastAge', () => {
  it('admits a member on their 18th birthday', () => {
    expect(isAtLeastAge('2008-09-05', 18, TODAY)).toBe(true);
  });

  it('refuses a member the day before their 18th birthday', () => {
    expect(isAtLeastAge('2008-09-06', 18, TODAY)).toBe(false);
  });

  it('admits a member the day after their 18th birthday', () => {
    expect(isAtLeastAge('2008-09-04', 18, TODAY)).toBe(true);
  });

  it('compares months before days: born a month later is still 17', () => {
    expect(isAtLeastAge('2008-10-05', 18, TODAY)).toBe(false);
    expect(isAtLeastAge('2008-08-05', 18, TODAY)).toBe(true);
  });

  it('compares years before months: born the previous December is 18, the next January is 17', () => {
    expect(isAtLeastAge('2007-12-31', 18, TODAY)).toBe(true);
    expect(isAtLeastAge('2009-01-01', 18, TODAY)).toBe(false);
  });

  it('turns N on 1 March in a non-leap year when born on 29 February', () => {
    const born = '2008-02-29';
    expect(isAtLeastAge(born, 18, utc(2026, 2, 28))).toBe(false);
    expect(isAtLeastAge(born, 18, utc(2026, 3, 1))).toBe(true);
  });

  it('turns N on 29 February itself in a leap year when born on 29 February', () => {
    expect(isAtLeastAge('2008-02-29', 20, utc(2028, 2, 29))).toBe(true);
    expect(isAtLeastAge('2008-02-29', 20, utc(2028, 2, 28))).toBe(false);
  });

  it('refuses a birth date in the future', () => {
    expect(isAtLeastAge('2030-01-01', 18, TODAY)).toBe(false);
  });

  it('refuses an unparseable date rather than admitting it', () => {
    expect(isAtLeastAge('x', 18, TODAY)).toBe(false);
    expect(isAtLeastAge('2023-02-29', 18, TODAY)).toBe(false);
  });

  it('honours the injected threshold: 0 years admits a birth today, 19 refuses the 18-year-old', () => {
    expect(isAtLeastAge('2026-09-05', 0, TODAY)).toBe(true);
    expect(isAtLeastAge('2008-09-05', 19, TODAY)).toBe(false);
  });

  it('reads today in UTC, the calendar the DB trigger uses — 23:30Z on the 5th is still the 5th', () => {
    expect(isAtLeastAge('2008-09-05', 18, utc(2026, 9, 5, 23, 30))).toBe(true);
  });

  it('is never more permissive than the trigger: 00:30 CEST on the birthday is still yesterday in UTC', () => {
    // 2026-09-05T22:30Z is 00:30 on 6 September in Rome. A member born 2008-09-06 is 18 on
    // their wall clock, but the trigger's `(now() at time zone 'utc')::date` says 5 September
    // — so this must refuse, or the flush fails with a 23514 the screen cannot explain.
    expect(isAtLeastAge('2008-09-06', 18, utc(2026, 9, 5, 22, 30))).toBe(false);
    // …and one UTC-day later it admits, on both clocks.
    expect(isAtLeastAge('2008-09-06', 18, utc(2026, 9, 6, 0, 30))).toBe(true);
  });
});
