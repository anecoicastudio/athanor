import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// NEXT_PUBLIC_* (hosted stack) live in .env.local; the service-role admin key for
// auth helpers lives in .env.test (gitignored, never committed).
// See .env.test.example for the one required secret.
loadEnv({ path: resolve(__dirname, '.env.local') });
loadEnv({ path: resolve(__dirname, '.env.test') });

const PORT = 3000;
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
