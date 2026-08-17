import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Same guard as packages/schemas/vitest.config.ts: an interrupted `pnpm mutation`
    // leaves .stryker-tmp/sandbox-*/ behind, and collecting the copies breaks the run.
    exclude: [...defaultExclude, '**/.stryker-tmp/**'],
    // Worker threads instead of forked processes (spawn dominated the run: ~64s
    // cumulative "prepare" vs ~2s of tests), and no per-file isolation — these tests
    // are pure functions of their inputs: no vi.mock, no globals, no shared state.
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
