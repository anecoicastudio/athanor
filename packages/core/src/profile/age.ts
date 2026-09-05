import { parseBirthDate } from './zodiac';

/** GDPR Art. 8 digital-consent floor as Italy set it (#694). The migration's guard mirrors it. */
export const MIN_MEMBER_AGE = 14;

/**
 * Has someone born on `isoBirthDate` reached `minYears` by `today`? The clock is injected
 * (core.md): a birthday is a boundary, and a function that reads today internally cannot be
 * pinned at one.
 *
 * `today` is read by its UTC parts, deliberately: `athanor.profiles_birth_date_guard` measures
 * the same boundary on `(now() at time zone 'utc')::date`, and the funnel must never be MORE
 * permissive than the trigger — a member admitted here at 00:30 CEST on their birthday, while
 * UTC still says yesterday, would otherwise pass the step and be refused at the flush with a
 * 23514 nothing on screen explains. Reading UTC here closes that window in both directions.
 *
 * Someone born on 29 February turns N on 1 March in a non-leap year, the same reading
 * Postgres gives `date - interval 'N years'`. Unparseable or future dates are refused.
 */
export function isAtLeastAge(isoBirthDate: string, minYears: number, today: Date): boolean {
  const born = parseBirthDate(isoBirthDate);
  if (!born) return false;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const targetY = born.y + minYears;
  if (targetY !== y) return targetY < y;
  if (born.m !== m) return born.m < m;
  return born.d <= d;
}
