/**
 * Pure day-bucketing for chat day-markers. Core injects the clock (`now`) — no inline
 * Date.now() (core.md). Compares device-local calendar days; the app maps `kind` to an
 * i18n label (today/yesterday) or formats `iso` as a date.
 */
export type DayBucket = { kind: 'today' | 'yesterday' | 'date'; iso: string };

export function dayBucket(createdAtIso: string, now: Date): DayBucket {
  const d = new Date(createdAtIso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return { kind: 'today', iso: createdAtIso };
  if (diffDays === 1) return { kind: 'yesterday', iso: createdAtIso };
  return { kind: 'date', iso: createdAtIso };
}
