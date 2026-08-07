import { defineConfig } from 'vitest/config';

// Mirrors packages/core/vitest.config.ts. Only t.ts is logic (catalogs are data);
// 90% matches the core/schemas precedent — do not lower.
export default defineConfig({
  test: {
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
