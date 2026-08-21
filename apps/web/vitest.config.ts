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
//
// `app/**/*.ts` rather than an enumerated list of route globs (2026-08-21, issue #423): the
// enumeration had already drifted past three files — `app/sitemap.ts`, `app/manifest.ts` and
// `app/robots.ts` sat outside the denominator, so `sitemap.test.ts` moved the test count and
// contributed nothing to the gate. The glob matches only plain-TS route modules; every page,
// layout and component is `.tsx` and stays out, which is the line the paragraph above draws.
export default defineConfig({
  test: {
    environment: 'node',
    // Worker threads instead of forked processes — spawn dominated the run. Isolation
    // STAYS on: these tests vi.mock next/* modules per file.
    pool: 'threads',
    // `components` is in the list because a test there was silently never collected:
    // `locale-provider.test.ts` landed in 217928e and matched no pattern, so it has never
    // run. A test that cannot fail is worse than no test — it reads as coverage.
    include: ['{app,components,lib,utils}/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'utils/**', 'app/**/*.ts'],
      exclude: ['**/*.test.ts'],
      // Ratcheted 2026-08-21 (issue #423) from 85/95/72/85. The old floors dated from
      // 2026-08-08 and their rationale — "the four modules with no logic of their own" —
      // had stopped being true: `lib/mandorla-svg.ts` was already fully covered, and the
      // `@supabase/ssr` factories plus `lib/utils.ts` are covered as of this change.
      //
      // Measured 2026-08-21, 26 files / 246 tests, all green:
      //   lines      638/638  100
      //   statements 638/638  100
      //   functions   43/43   100
      //   branches   153/154   99.35   (the one miss is `reports/[id]/actions.ts:23`)
      //
      // Each floor is a BAND under the measurement, not the measurement itself — the same
      // convention `apps/native/vitest.config.ts` documents and PR #422 applied. A floor is
      // only raised as far as it survives new *uncovered* code arriving, because the point of
      // the band is that adding one untested helper is a code-review conversation and not a
      // red build. Headroom at these numbers: ~31 uncovered lines, 3 functions, 6 branches.
      //
      // Functions gets the wider band (92, not 95) purely because its denominator is 43: one
      // uncovered function is 2.3 points, so 95 would tolerate two and fire on the third.
      // Branches HOLDS at 95 rather than rising to meet 99.35, for the reason the native file
      // records — the v8 branch denominator swings on test-only commits, and at 154 branches
      // each one is 0.65 points, so a floor set at the measurement would flap.
      //
      // Never lower one of these to make a run green (core.md precedent). If a new module
      // cannot be reached by this harness, that is an argument about `coverage.include`, made
      // in the comment above with a reason — not an argument for a smaller number here.
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 92,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
    },
  },
});
