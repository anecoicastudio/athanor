import { defineConfig } from 'vitest/config';

// Vitest config used ONLY by Stryker (stryker.config.json points at this file).
//
// It exists to drop the coverage block. Stryker runs the suite once per surviving mutant, and
// a mutant's job is to make tests fail — so the coverage thresholds in vitest.config.ts would
// trip on nearly every run and turn a killed mutant into a runner error. Mutation score is the
// signal here; line coverage is measured by the normal `test` script.
//
// Nothing else is relaxed: same environment, same test files, same assertions. (Pooling does
// differ from vitest.config.ts — Stryker's runner sets its own threads pool and default
// isolation, so this harness is MORE isolated than `pnpm test`, never less.)
export default defineConfig({
  test: {
    coverage: { enabled: false },
  },
});
