import { defineConfig } from 'vitest/config';

// Mirrors packages/core/vitest.config.ts — 90% thresholds enforced (audit 2026-07-09;
// core.md precedent: do not lower them).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
