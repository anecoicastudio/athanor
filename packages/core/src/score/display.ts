import { STAR_KEYS, type Breakdown, type Star, type StarKey } from '@athanor/schemas';

export type BreakdownRow = { key: keyof Breakdown; value: number; width: number };

const ORDER: (keyof Breakdown)[] = [
  'contributi',
  'eventi',
  'collaborazioni',
  'valore',
  'recensioni',
  'affidabilita',
];

/** Six display rows; width = value / maxBucket (display normalization, NOT a score — spec §3.1). */
export function breakdownRows(b: Breakdown): BreakdownRow[] {
  const max = Math.max(0, ...ORDER.map((k) => b[k]));
  return ORDER.map((key) => ({
    key,
    value: b[key],
    width: max > 0 ? Math.min(1, Math.max(0, b[key] / max)) : 0,
  }));
}

export type NextStar = { starId: StarKey; done: number; total: number; unit: string };

/** Closest unearned star by progress ratio; tie-break canonical order. Display selection, not criteria eval (§3.3). */
export function pickNextStar(stars: Star[]): NextStar | null {
  const unearned = stars.filter((s) => s.grantedAt == null);
  if (unearned.length === 0) return null;
  const ratio = (s: Star) => (s.progress.total > 0 ? s.progress.done / s.progress.total : 0);
  const order = (s: Star) => STAR_KEYS.indexOf(s.starId);
  const best = unearned.reduce((a, b) => {
    const d = ratio(b) - ratio(a);
    if (d > 1e-9) return b;
    if (d < -1e-9) return a;
    return order(a) <= order(b) ? a : b;
  });
  return {
    starId: best.starId,
    done: best.progress.done,
    total: best.progress.total,
    unit: best.progress.unit,
  };
}
