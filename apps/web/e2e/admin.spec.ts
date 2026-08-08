import { test, expect } from '@playwright/test';

/**
 * M9 web admin smoke (PRD §10 / Task 9):
 *   (a) unauthenticated /admin redirects to /admin/login
 *   (b) /admin/login renders the email-form submit button
 *
 * Authenticated flows (queue, verdict) require a seeded admin session
 * (app_metadata.role='admin') — add in a later slice with a service-role helper.
 */

test('unauthenticated /admin redirects to login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('login screen renders the email form', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('button', { name: /link/i })).toBeVisible();
});
