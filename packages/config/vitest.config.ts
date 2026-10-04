import { defineConfig } from 'vitest/config';

// Mirrors packages/i18n/vitest.config.ts. This package was data, not logic, when the suite
// arrived — tokens.ts is a wall of `as const` objects — so it exists for a different reason
// than core's: without a `test` script, `turbo test` skipped this workspace in SILENCE, and a
// workspace that is never run looks identical to one that always passes (#172). 90% matches
// the core/schemas precedent; constants reach it trivially. The floor has bitten since
// 2026-10-03, when contrast.ts moved here from apps/native: that file has branches, and a new
// one needs its test in contrast.test.ts.
export default defineConfig({
  test: {
    // Threads + no isolation, same rationale as core/i18n: pure tests (no vi.mock, no
    // globals), so worker spawn was most of the wall time.
    pool: 'threads',
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
