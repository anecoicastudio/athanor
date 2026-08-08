import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// NEXT_PUBLIC_* (hosted stack) live in .env.local. The current smoke tests need no
// secrets; future authenticated flows seed via CI secrets, never an env file the Next
// process can read (supabase/ENV-NOTES.md).
loadEnv({ path: resolve(__dirname, '.env.local') });

const PORT = 3000;
// E2E_BASE_URL overrides the target (e.g. a deployed preview); defaults to local dev.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
