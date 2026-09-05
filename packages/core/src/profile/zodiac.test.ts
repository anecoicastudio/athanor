import { ZODIAC_SIGNS } from '@athanor/schemas';
import { describe, expect, it } from 'vitest';
import { ZODIAC_STARTS, parseBirthDate, zodiacSignFromBirthDate } from './zodiac';

/**
 * The Italian fixed-cusp convention, settled 2026-09-05 (#694). The database holds the same
 * table in `athanor.zodiac_sign(date)` and 0146 pins the same 24 days against it; this file
 * is what keeps the funnel's live «Sei Leone» reveal from disagreeing with what the row will
 * say a minute later.
 */
describe('ZODIAC_STARTS', () => {
  it('names every sign in @athanor/schemas exactly once, in calendar order from acquario', () => {
    const signs = ZODIAC_STARTS.map(([sign]) => sign);
    expect(new Set(signs).size).toBe(12);
    expect([...signs].sort()).toEqual([...ZODIAC_SIGNS].sort());
    expect(signs[0]).toBe('acquario');
    expect(signs.at(-1)).toBe('capricorno');
  });

  it('is strictly ascending by (month, day) — a table that is not sorted cannot be walked', () => {
    const ordinals = ZODIAC_STARTS.map(([, m, d]) => m * 100 + d);
    for (let i = 1; i < ordinals.length; i += 1) {
      expect(ordinals[i]!).toBeGreaterThan(ordinals[i - 1]!);
    }
  });
});

describe('parseBirthDate', () => {
  it.each([
    ['2000-02-29', { y: 2000, m: 2, d: 29 }],
    ['1900-01-01', { y: 1900, m: 1, d: 1 }],
    ['2012-12-31', { y: 2012, m: 12, d: 31 }],
  ])('accepts %s as a real calendar day', (iso, parts) => {
    expect(parseBirthDate(iso)).toEqual(parts);
  });

  it.each([
    ['', 'empty'],
    ['2020-2-1', 'unpadded'],
    ['20200201', 'no dashes'],
    ['2020-02-01T00:00:00Z', 'a datetime, not a day'],
    ['abcd-ef-gh', 'letters'],
    ['2020-13-01', 'month 13'],
    ['2020-00-10', 'month 0'],
    ['2020-04-31', 'April has 30 days'],
    ['2020-02-30', 'February never has 30'],
    ['2023-02-29', 'not a leap year'],
    ['1900-02-29', 'century rule: 1900 is not a leap year'],
    ['2020-01-00', 'day 0'],
  ])('refuses %s (%s)', (iso) => {
    expect(parseBirthDate(iso)).toBeNull();
  });

  it('applies the 400-year rule: 2000-02-29 exists', () => {
    expect(parseBirthDate('2000-02-29')).not.toBeNull();
  });
});

describe('zodiacSignFromBirthDate', () => {
  // First and last day of every sign — the 24 cusp days. Each pair is what would flip if a
  // boundary in ZODIAC_STARTS were off by one in either direction.
  it.each([
    ['ariete', '2000-03-21', '2000-04-20'],
    ['toro', '2000-04-21', '2000-05-20'],
    ['gemelli', '2000-05-21', '2000-06-21'],
    ['cancro', '2000-06-22', '2000-07-22'],
    ['leone', '2000-07-23', '2000-08-23'],
    ['vergine', '2000-08-24', '2000-09-22'],
    ['bilancia', '2000-09-23', '2000-10-22'],
    ['scorpione', '2000-10-23', '2000-11-22'],
    ['sagittario', '2000-11-23', '2000-12-21'],
    ['capricorno', '2000-12-22', '2001-01-20'],
    ['acquario', '2000-01-21', '2000-02-19'],
    ['pesci', '2000-02-20', '2000-03-20'],
  ])('%s runs from %s to %s inclusive', (sign, first, last) => {
    expect(zodiacSignFromBirthDate(first)).toBe(sign);
    expect(zodiacSignFromBirthDate(last)).toBe(sign);
  });

  it('wraps the year for capricorno: New Year’s Day and 20 January are both capricorno', () => {
    expect(zodiacSignFromBirthDate('1990-01-01')).toBe('capricorno');
    expect(zodiacSignFromBirthDate('1990-01-20')).toBe('capricorno');
    expect(zodiacSignFromBirthDate('1990-12-31')).toBe('capricorno');
  });

  it('places the leap day in pesci', () => {
    expect(zodiacSignFromBirthDate('2000-02-29')).toBe('pesci');
    expect(zodiacSignFromBirthDate('2024-02-29')).toBe('pesci');
  });

  it('ignores the year: the same month and day give the same sign in 1950 and 2010', () => {
    expect(zodiacSignFromBirthDate('1950-08-10')).toBe('leone');
    expect(zodiacSignFromBirthDate('2010-08-10')).toBe('leone');
  });

  it.each(['', '2023-02-29', '2020-13-01', '2020-04-31', '2020-02-01T00:00:00Z', 'x'])(
    'returns null for an unparseable date (%s) rather than guessing a sign',
    (iso) => {
      expect(zodiacSignFromBirthDate(iso)).toBeNull();
    },
  );
});
