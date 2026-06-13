import { expect, test } from '@playwright/test';
import { createConfirmedUser, deleteUser, magicTokenHash } from './helpers/auth';

/**
 * M1 web smoke (PRD §10): login → onboarding → /profilo → edit → save.
 * Runs against the local Supabase stack (`supabase start`). Auth is minted via
 * the admin API (see helpers/auth.ts) — the login form is still exercised, but
 * the actual session comes from driving /auth/confirm with a real token.
 */

// Unique per run so handle + e-mail never collide with rows from earlier runs.
const stamp = Date.now();
const email = `e2e-${stamp}@kaira.test`;
const handle = `e2e_${stamp}`.slice(0, 30);

let userId: string;

test.beforeAll(async () => {
  userId = await createConfirmedUser(email);
});

test.afterAll(async () => {
  if (userId) await deleteUser(userId);
});

test('login → onboarding → profilo → edit → save', async ({ page }) => {
  // 1. Login form renders and accepts the e-mail (magic-link request UI).
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole('button', { name: 'Inizia il tuo Kairos' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible();

  // 2. Authenticate deterministically via the real confirm route, then onboarding.
  const tokenHash = await magicTokenHash(email);
  await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=magiclink`);
  await expect(page).toHaveURL(/\/onboarding/);

  // 3. Onboarding — step 0: handle (type a fresh one, wait for availability).
  await expect(page.getByRole('heading', { name: 'Come ti chiamiamo?' })).toBeVisible();
  await page.locator('input').first().fill(handle);
  const next = page.getByRole('button', { name: 'Avanti' });
  await expect(next).toBeEnabled({ timeout: 5_000 });
  await next.click();

  // step 1: identity — chips are the only aria-pressed buttons on this step.
  await page.locator('button[aria-pressed]').first().click();
  await next.click();

  // step 2: seeking.
  await page.locator('button[aria-pressed]').first().click();
  await next.click();

  // step 3: dream → plant it → lands on /profilo.
  await page.getByRole('textbox').fill('Il mio sogno di prova e2e.');
  await page.getByRole('button', { name: /Pianta il sogno/ }).click();
  await expect(page).toHaveURL(/\/profilo/);

  // 4. Profilo renders the new identity.
  await expect(page.getByRole('heading', { name: `@${handle}` })).toBeVisible();

  // 5. Edit the bio and save.
  await page.getByRole('button', { name: 'Modifica' }).click();
  await page.getByRole('textbox').first().fill('Bio di prova e2e');
  await page.getByRole('button', { name: 'Salva' }).click();

  // Save resolved: edit mode closed (Modifica back) and the bio shows in read mode.
  await expect(page.getByRole('button', { name: 'Modifica' })).toBeVisible();
  await expect(page.getByText('Bio di prova e2e')).toBeVisible();
});
