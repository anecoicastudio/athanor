import { defineConfig } from 'vitest/config';

// Coverage floor, ratcheted 2026-08-08 after taking the twelve query-key-only modules to
// behavioural coverage (lines 52% → 93%), then again the same day after covering the last
// two unassigned modules — waitlist.ts (55% → 100) and profiles.ts (50% → 100). Ratchet UP
// as tests land, never down (core.md precedent). Branches trail at 86 and are the remaining
// gap: the untested arms are concentrated in fund.ts, momenti.ts and notificationPreferences.ts.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/database.types.ts', 'src/test-support/**'],
      thresholds: {
        lines: 95,
        branches: 86,
        functions: 93,
        statements: 95,
      },
    },
  },
});
