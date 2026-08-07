import { defineConfig } from 'vitest/config';

// Coverage floor, ratcheted 2026-08-07 after covering the 13 previously-untested
// modules (lines 23.9% → 52%). Ratchet UP as tests land, never down (core.md
// precedent). Target is the 90% the core/schemas packages enforce.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/database.types.ts'],
      thresholds: {
        lines: 50,
        branches: 80,
        functions: 55,
        statements: 50,
      },
    },
  },
});
