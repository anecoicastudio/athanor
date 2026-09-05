import { parseBirthDate } from './zodiac';

/** GDPR Art. 8 digital-consent floor as Italy set it (#694). The migration's guard mirrors it. */
export const MIN_MEMBER_AGE = 14;

/**
 * Has someone born on `isoBirthDate` reached `minYears` by `today`? The clock is injected
 * (core.md): a birthday is a boundary, and a function that reads today internally cannot be
 * pinned at one. `today` is read by LOCAL parts — the member's calendar, not UTC's.
 *
 * Someone born on 29 February turns N on 1 March in a non-leap year, the same reading
 * Postgres gives `date - interval 'N years'` in `athanor.profiles_birth_date_guard`.
 * Unparseable or future dates are refused, never admitted.
 */
export function isAtLeastAge(isoBirthDate: string, minYears: number, today: Date): boolean {
  const born = parseBirthDate(isoBirthDate);
  if (!born) return false;
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  const targetY = born.y + minYears;
  if (targetY !== y) return targetY < y;
  if (born.m !== m) return born.m < m;
  return born.d <= d;
}
