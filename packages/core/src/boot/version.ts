/**
 * True iff `current` is a strictly lower release than `min` (per-segment numeric compare,
 * `1.2` == `1.2.0`). FAIL-OPEN: any missing/unparseable input returns `false` so a bad
 * remote value or a missing app version can never lock a user behind the force-update gate.
 * Backs frontend 12 §10.1 (min-version gate).
 *
 * KEEP IN SYNC with the Deno mirror in `supabase/functions/_shared/version-gate.ts`
 * (edge functions can't import workspace packages) — same compare, same fail-open contract.
 */
export function isVersionBelow(
  current: string | null | undefined,
  min: string | null | undefined,
): boolean {
  const a = parseVersion(current);
  const b = parseVersion(min);
  if (!a || !b) return false; // fail-open
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

/** Dotted numeric segments, or null if any segment is non-numeric / the string is empty. */
function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const parts = v.split('.');
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums.length ? nums : null;
}
