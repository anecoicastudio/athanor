import { defineConfig } from 'vitest/config';

// Coverage floor, established 2026-08-08 after extracting logic out of .tsx screens into
// testable modules (13 tests → 26 files). Ratchet UP as tests land, never down (core.md
// precedent).
//
// The denominator is scoped to the directories this harness can actually reach. `environment:
// 'node'` plus a `*.test.ts` glob means the 176 .tsx files under src/ can never be collected —
// react-native ships untranspiled Flow, so nothing that renders is reachable — and counting them
// produced a 3% headline that no amount of real testing could move. Scoped to src/lib +
// src/hooks the number is a ratchet again: it rises when logic gets tested and falls when a test
// is deleted.
//
// Lines/statements stay well under 100 because ~28 modules in here are thin wrappers over native
// modules (expo-image-picker, expo-notifications, the Supabase client, the auth context) that
// need a renderer or a device, not because the tested logic is thinly covered — branches sit at
// ~90. Adding a component harness is what unlocks those; until then, do not lower these.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/hooks/**'],
      // Ratcheted 2026-08-09 (37/89/72/37 → 38/89/73/38) after covering locale, links and the
      // sentry init/consent lifecycle. Each floor is a BAND, not the measured number: measured is
      // 568/1425 lines (39.85), 75/98 functions (76.53), 291/322 branches (90.37), and a floor
      // is only raised as far as it survives new *uncovered* code arriving — 38 lines tolerates
      // ~69 new uncovered lines, 73 functions tolerates 4. Branches stay at 89 deliberately:
      // the v8 branch denominator swings on test-only commits, so 90 would leave one branch of
      // headroom and flap. Never lower a floor to make a run green.
      thresholds: {
        lines: 38,
        branches: 89,
        functions: 73,
        statements: 38,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  define: {
    __DEV__: true,
  },
});
