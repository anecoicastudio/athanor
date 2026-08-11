import { defineConfig } from 'vitest/config';

// Coverage floor, ratcheted 2026-08-08 after taking the twelve query-key-only modules to
// behavioural coverage (lines 52% → 93%), then again the same day after covering the last two
// unassigned modules — waitlist.ts (55% → 100) and profiles.ts (50% → 100). Branches followed
// on 2026-08-09 (86 → 90) via the failure and null-payload arms in connections.ts, events.ts
// and admin.ts. Ratchet UP as tests land, never down (core.md precedent).
//
// An earlier version of this comment named fund.ts / momenti.ts / notificationPreferences.ts as
// the branch gap. Measured, that was wrong — the concentration was connections.ts (10 uncovered
// branches), events.ts (12) and admin.ts (8), nearly all of them `if (error) throw error` and
// `?? []` arms that no test could reach while every stub hardcoded `error: null`.
//
// Branches again 2026-08-09, 90.84 → 97.40 (75 uncovered → 22). Same two shapes as before, and
// the same root cause — the remaining hand-rolled stubs could not express a database failure, so
// every rethrow arm was unreachable. New tests use `makeFakeClient` + the `asClient` / `DB_DOWN`
// helpers it now exports (src/test-support); do not teach a local stub a new trick instead.
//
// Two lessons from that sweep, both worth keeping:
//   - Picking files by uncovered-COUNT optimises the metric, not the risk. The nine biggest were
//     all `?? []` guards that are dead at runtime AND at the type level (a zero-match list select
//     returns [], and the rethrow above narrows `data` to T[]). The genuinely reachable arms were
//     in the small files: `invites.ts` `count ?? 0` (really null when content-range is absent),
//     `notificationPreferences.ts` `?? true` (the DEFAULT-ON master push toggle, off a maybeSingle
//     that is routinely null), and the silent no-session returns in `pushTokens.ts` — a device that
//     never registers and never says why.
//   - The denominator is not stable. v8 counts branches only inside executed code, so covering a
//     happy path drags that function's other arms into the total: this test-only change moved it
//     819 → 847. A threshold set flush against the measured percentage can go red on a commit that
//     strictly adds tests.
//
// So the band is computed, not felt: 825 covered, `96` absorbs 12 new uncovered branches
// (825/859 = 96.04%), roughly four new functions of the `if (error) throw error` + `?? []` shape.
// Recompute rather than widening by feel — solve covered/(total+n) >= break for n. Ratchet UP as
// tests land, never down (core.md precedent).
export default defineConfig({
  test: {
    // Worker threads instead of forked processes — spawn dominated the run. Isolation
    // STAYS on: these tests vi.mock the Supabase client per file.
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/database.types.ts', 'src/test-support/**'],
      thresholds: {
        lines: 95,
        branches: 96,
        functions: 93,
        statements: 95,
      },
    },
  },
});
