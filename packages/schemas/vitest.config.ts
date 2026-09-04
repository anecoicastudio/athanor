import { defaultExclude, defineConfig } from 'vitest/config';

// Mirrors packages/core/vitest.config.ts — 90% thresholds enforced (audit 2026-07-09;
// core.md precedent: do not lower them).
export default defineConfig({
  test: {
    // A mutation run that dies before cleanup (Ctrl-C, a killed job) leaves
    // .stryker-tmp/sandbox-*/ behind — a full copy of the package, tests included. Vitest
    // would then collect every test twice, and the sandbox copies of the *.mirror.test.ts
    // files fail on paths they cannot resolve from two directories deeper. The symptom is
    // an ENOENT in a file nobody edited, so exclude the sandbox rather than debug it again.
    exclude: [...defaultExclude, '**/.stryker-tmp/**'],
    // Threads + no isolation, same rationale as core: pure tests (no vi.mock, no
    // globals), so worker spawn was most of the wall time.
    pool: 'threads',
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
