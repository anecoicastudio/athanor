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
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/database.types.ts', 'src/test-support/**'],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 93,
        statements: 95,
      },
    },
  },
});
