import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// NEXT_PUBLIC_* (hosted stack) live in .env.local. The authenticated flows below need a
// seeded admin session, and the `sb_secret_…` key that mints it never reaches this process:
// `e2e/seed/seed-admin.mts` runs as its own step and leaves a storage state behind (see
// supabase/ENV-NOTES.md). `webServer` below inherits this process's env, so a secret
// exported around `playwright test` would be readable by the Next dev server.
loadEnv({ path: resolve(__dirname, '.env.local') });

const PORT = 3000;
// E2E_BASE_URL overrides the target (e.g. a deployed preview); defaults to local dev.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/** Written by `pnpm e2e:seed`; gitignored. Its absence means "unauthenticated specs only". */
const storageState = resolve(__dirname, 'e2e/.auth/admin.json');
const AUTHENTICATED_SPECS = /admin-authenticated\.spec\.ts/;
const seeded = existsSync(storageState);

// Fail closed rather than run a shorter suite in silence. On CI the seeding step and the
// test step are gated on the same `check e2e secrets` output, so if this file is missing
// here the seed did not do its job — and a green run that quietly skipped the authenticated
// half is exactly the "never ran reads as passed" failure #146 closed.
if (process.env.CI && !seeded) {
  throw new Error(
    'e2e/.auth/admin.json is missing — run the seeding step (pnpm e2e:seed) before playwright test',
  );
}

export default defineConfig({
  testDir: './e2e',
  // Keep serial — tests share no state here but avoids port conflicts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    locale: 'it-IT',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: AUTHENTICATED_SPECS },
    ...(seeded
      ? [
          {
            name: 'admin',
            testMatch: AUTHENTICATED_SPECS,
            use: { ...devices['Desktop Chrome'], storageState },
            // No retries, deliberately, and this is the one project that needs the exception:
            // its verdict specs resolve a seeded report, and `resolve_report` is idempotent —
            // a second attempt finds the report already resolved, the form gone, and fails for
            // a reason that has nothing to do with the first failure. A retry that cannot
            // reproduce the state is a worse signal than no retry.
            retries: 0,
          },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
