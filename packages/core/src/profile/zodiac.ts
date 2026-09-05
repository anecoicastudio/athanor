import { type ZodiacSign } from '@athanor/schemas';

/**
 * The Italian fixed-cusp convention (#694), as `[sign, startMonth, startDay]` in calendar order.
 * Capricorno's entry is its 22 December start; the January days before acquario belong to it
 * by the wrap in `zodiacSignFromBirthDate`.
 *
 * One home for this table is `athanor.zodiac_sign(date)` — the generated column is what the
 * profile row will say. This mirror exists for the funnel's live «Sei Leone» reveal, before
 * any row exists; `zodiac.test.ts` pins the same 24 boundary days 0146 pins against the SQL.
 */
export const ZODIAC_STARTS: ReadonlyArray<readonly [ZodiacSign, number, number]> = [
  ['acquario', 1, 21],
  ['pesci', 2, 20],
  ['ariete', 3, 21],
  ['toro', 4, 21],
  ['gemelli', 5, 21],
  ['cancro', 6, 22],
  ['leone', 7, 23],
  ['vergine', 8, 24],
  ['bilancia', 9, 23],
  ['scorpione', 10, 23],
  ['sagittario', 11, 23],
  ['capricorno', 12, 22],
];

export type CalendarDay = { y: number; m: number; d: number };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/**
 * Strict `YYYY-MM-DD` → calendar parts, or null for anything else — malformed text, a
 * datetime, or an impossible day (2023-02-29). No `Date` involved: `new Date('2023-02-29')`
 * would happily roll over to 1 March, and a birthday must not.
 */
export function parseBirthDate(iso: string): CalendarDay | null {
  const match = ISO_DAY.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Sun sign for a `YYYY-MM-DD` birth date, or null when the date does not parse. */
export function zodiacSignFromBirthDate(iso: string): ZodiacSign | null {
  const day = parseBirthDate(iso);
  if (!day) return null;
  const ordinal = day.m * 100 + day.d;
  let sign: ZodiacSign = 'capricorno'; // 1 January … 20 January: before the first start
  for (const [candidate, m, d] of ZODIAC_STARTS) {
    if (ordinal >= m * 100 + d) sign = candidate;
  }
  return sign;
}
