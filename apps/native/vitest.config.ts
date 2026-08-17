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
// ~93. Adding a component harness is what unlocks those; until then, do not lower these.
export default defineConfig({
  test: {
    environment: 'node',
    // Worker threads instead of forked processes — spawn dominated the run. Isolation
    // STAYS on: these tests vi.mock expo modules and the Supabase client per file.
    pool: 'threads',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/hooks/**'],
      // Ratcheted 2026-08-09, twice (37/89/72/37 → 38/89/73/38 → 39/89/74/39), then again
      // 2026-08-17 to 50/91/79/50 (#172). The jump is not new discipline: #413 extracted the
      // candidacy wizard out of its .tsx screen into src/lib/candidacy-wizard.ts and #415 did
      // the same for the media upload path, so a large block of already-tested logic moved
      // INTO the include globs at once. #413 measured 49.77/92.8/80.54/49.77 and deliberately
      // left the floors alone; #415 landed after it and moved them again.
      //
      // Each floor is a BAND, not the measured number. Measured 2026-08-17: 1350/2633 lines
      // (51.27), 163/199 functions (81.90), 688/738 branches (93.22). A floor is only raised
      // as far as it survives new *uncovered* code arriving — 50 lines tolerates ~67 new
      // uncovered lines, 79 functions tolerates 7, 91 branches tolerates 18. Branches keep the
      // widest band for the same reason they sat at 89 for three rounds: the v8 branch
      // denominator swings on test-only commits (819→847 on one in packages/api), so a floor
      // set at the measured number would flap.
      //
      // Lines/statements stay near half because the denominator is still dominated by the ~28
      // modules that need a renderer or a device. A component harness is what unlocks the rest;
      // until then these move when logic leaves .tsx. Never lower a floor to make a run green.
      thresholds: {
        lines: 50,
        branches: 91,
        functions: 79,
        statements: 50,
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
