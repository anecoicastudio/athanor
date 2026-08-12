import {
  STAR_KEYS,
  type AuraEvent,
  type Breakdown,
  type Star,
  type StarKey,
} from '@athanor/schemas';
import { BUCKET_ORDER } from './weights.ts';

export type BreakdownRow = { key: keyof Breakdown; value: number; width: number };

const ORDER: readonly (keyof Breakdown)[] = BUCKET_ORDER;

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
  // Three survive in this reduce — an equivalent mutant in effect, though for reachability
  // rather than strict logical equivalence:
  //   - widening either epsilon comparison to `>=` / `<=` differs only at a ratio gap of
  //     exactly ±1e-9. Integer done/total *can* produce that (1/1_000_000_000), but star totals
  //     are 2–10 (STAR_CRITERIA), so nothing near it is reachable.
  //   - `<=` vs `<` on the tie-break differs only for two stars sharing a starId. The unique
  //     index `stars_one_per_profile (profile_id, star_id)` in
  //     supabase/migrations/20260617105202_stars.sql makes that row pair impossible.
  // Neither is worth a fixture that could not occur; both would assert the mutant, not the spec.
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

export type WeekRecap = {
  auraWeek: number;
  contributi: number;
  sogniAiutati: number;
  streakDays: number;
};

type WeekEvent = Pick<AuraEvent, 'type' | 'points' | 'createdAt'>;

/** UTC day key (YYYY-MM-DD) — deterministic, tz-stable for streak/window math. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Weekly recap — display aggregation of persisted ledger rows (rule #1: no score compute/write). `now` injected. */
export function summarizeWeek(events: WeekEvent[], now: Date): WeekRecap {
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let auraWeek = 0,
    contributi = 0,
    sogniAiutati = 0;
  const positiveDays = new Set<string>();

  for (const e of events) {
    const at = new Date(e.createdAt);
    if (e.points > 0) positiveDays.add(dayKey(at));
    if (at >= windowStart && at <= now) {
      if (e.points > 0) {
        auraWeek += e.points;
        contributi += 1;
      }
      if (e.type === 'milestone_help') sogniAiutati += 1;
    }
  }

  let streakDays = 0;
  for (let i = 0; i < 7; i++) {
    const day = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    if (positiveDays.has(day)) streakDays += 1;
    else break;
  }

  return { auraWeek, contributi, sogniAiutati, streakDays };
}
