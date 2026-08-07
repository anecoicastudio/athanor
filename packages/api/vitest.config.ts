import { defineConfig } from 'vitest/config';

// Coverage baseline measured 2026-08-07 (audit Tier-2/3 pass) — thresholds sit at
// the floor of what the suite covered that day. Ratchet UP as tests land, never down
// (core.md precedent). Target is the 90% the core/schemas packages enforce.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/database.types.ts'],
      thresholds: {
        lines: 20,
        branches: 75,
        functions: 40,
        statements: 20,
      },
    },
  },
});
