import { defineConfig } from 'vitest/config';

// Unit tests for the parts of the marketing + admin site that are pure enough to run without a
// renderer: the lib/ helpers, the Supabase key resolution, and the route handlers / server
// actions. Components are covered by the Playwright suite in e2e/ instead — `test:e2e`.
//
// `environment: 'node'` because everything here runs server-side. Next's own runtime globals
// (Request/Response/Headers) are Node 22 built-ins, so route handlers need no DOM shim; the
// `next/*` modules they import are mocked per-file.
//
// coverage.include is scoped to what this harness can reach. Pulling app/**/page.tsx and
// components/** into the denominator would produce a headline that no amount of unit testing
// could move, and hide whether the reachable surface is actually covered. Ratchet UP as tests
// land, never down (core.md precedent).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{app,lib,utils}/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'lib/**',
        'utils/**',
        'app/api/**',
        'app/admin/**/route.ts',
        'app/admin/**/actions.ts',
      ],
      exclude: ['**/*.test.ts'],
      // Floor set to the measured value, 2026-08-08. What is left uncovered is the four
      // modules with no logic of their own: `lib/utils.ts` (cn = twMerge(clsx(...))),
      // `lib/mandorla-svg.ts` (a path string), and the `@supabase/ssr` client factories,
      // whose only behaviour is cookie plumbing. Ratchet UP as tests land, never down
      // (core.md precedent).
      thresholds: {
        lines: 85,
        branches: 93,
        functions: 72,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
    },
  },
});
