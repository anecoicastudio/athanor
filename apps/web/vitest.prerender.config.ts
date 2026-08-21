import { defineConfig } from 'vitest/config';

// Build-output checks, kept OUT of the unit suite (vitest.config.ts) on purpose: they read
// `.next/` and must fail when no build has happened — see build-checks/prerender-manifest.test.ts.
// Run with `pnpm test:prerender` after `next build` / `opennextjs-cloudflare build`; CI runs it
// at the end of the `web build` job. No coverage: nothing here is application code.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['build-checks/**/*.test.ts'],
  },
});
