import { clampScore } from './clamp';
import { BUCKET_MAP, type BucketKey } from './weights';

const BUCKETS: BucketKey[] = [
  'contributi',
  'eventi',
  'collaborazioni',
  'valore',
  'recensioni',
  'affidabilita',
];

export interface LedgerLine {
  type: string;
  points: number;
}

/** Display bucket for a ledger type, or null (decay / unbucketed). */
export function bucketOf(type: string): BucketKey | null {
  return (BUCKET_MAP as Record<string, BucketKey>)[type] ?? null;
}

/**
 * Full re-aggregation of a profile's ledger (order-independent — replaying events
 * in any order yields the same result, so out-of-order domain events converge).
 * Headline `score` = clamped sum of ALL points (incl. decay); each `breakdown`
 * bucket = clamped sum of its mapped types (display-only, ≥ 0; need not equal score).
 */
export function aggregateScore(events: LedgerLine[]): {
  score: number;
  breakdown: Record<BucketKey, number>;
} {
  const breakdown = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<BucketKey, number>;
  let raw = 0;
  for (const e of events) {
    raw += e.points;
    const bucket = bucketOf(e.type);
    if (bucket) breakdown[bucket] += e.points;
  }
  for (const b of BUCKETS) breakdown[b] = Math.max(0, breakdown[b]);
  return { score: clampScore(raw), breakdown };
}
