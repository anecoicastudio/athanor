import { defineConfig } from 'vitest/config';

// Mirrors packages/core/vitest.config.ts. Only t.ts is logic (catalogs are data);
// 90% matches the core/schemas precedent — do not lower.
export default defineConfig({
  test: {
    // Threads + no isolation, same rationale as core: pure tests (no vi.mock, no
    // globals), so worker spawn was most of the wall time.
    pool: 'threads',
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/catalogs/**'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
