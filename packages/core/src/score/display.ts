import type { Breakdown } from '@athanor/schemas';

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
