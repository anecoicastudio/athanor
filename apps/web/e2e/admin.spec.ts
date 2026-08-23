import { test, expect } from '@playwright/test';

/**
 * M9 web admin smoke (PRD §10 / Task 9) — the UNAUTHENTICATED half:
 *   (a) unauthenticated /admin redirects to /admin/login
 *   (b) /admin/login renders the email-form submit button
 *   (c) the waitlist CSV export refuses an unauthenticated caller
 *
 * (c) is here rather than beside the authenticated specs because it needs the absence of a
 * session, which is this project's whole configuration. It is also the one admin surface
 * that is NOT under the `(dashboard)` layout's `isAdmin()` gate — a route handler answers it
 * directly, and nothing runs in front of it since proxy.ts left with the Cloudflare
 * migration, so the 403 is the gate.
 *
 * Authenticated flows (queue, verdicts, fund audit, waitlist) live in
 * `admin-authenticated.spec.ts`, under the `admin` project, and need `pnpm e2e:seed` first.
 */

test('unauthenticated /admin redirects to login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('login screen renders the email form', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('button', { name: /link/i })).toBeVisible();
});

test('the waitlist export refuses an unauthenticated caller', async ({ page }) => {
  const response = await page.request.get('/admin/waitlist/export');
  expect(response.status()).toBe(403);
});
