import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { reportPenaltyPoints } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Fixtures } from './seed/seed-admin.mts';

/**
 * Authenticated web-admin e2e (#174) — the half `admin.spec.ts` could never reach.
 *
 * These run under the `admin` project, whose `storageState` is the session
 * `e2e/seed/seed-admin.mts` minted for a disposable admin (`app_metadata.role='admin'`).
 * Everything they touch was created by that seed: the reports resolved here are ours, never
 * one of the twelve staging personas' — a verdict writes the audit log and, upheld, enqueues
 * a real Aura penalty.
 *
 * Copy is read through `@athanor/i18n` rather than pasted: the panel renders IT, and a
 * literal in a spec is a second copy of a catalog string that no parity test governs.
 *
 * Serial, because the verdict specs consume the state the ones after them assert on, and
 * `resolve_report` is idempotent — a report can only be resolved once, so a stray re-run of
 * one test in the middle proves nothing.
 *
 * What is NOT covered, and why: `suspend` and `ban` verdicts have no UI to drive (#311 —
 * `VerdictForm` offers dismiss and uphold only), and `resolve_report` routes both through
 * `enqueue_moderation_enforce`, which reaches GoTrue.
 */

test.describe.configure({ mode: 'serial' });

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, '.auth/fixtures.json'), 'utf8'),
) as Fixtures;

/** The panel's locale: `getLocale()` defaults to IT and nothing here sets the cookie. */
const IT = 'it' as const;

/** The resolved-verdict banner. A `<p>`, which is what tells it apart from the audit row
 *  below it — the two render the same "{status} — {resolution}" text. */
function banner(page: Page, status: 'dismissed' | 'upheld') {
  return page.locator('p').filter({ hasText: t(`admin.status.${status}`, IT) });
}

/** Fill the verdict form and submit; resolves once the server action has redirected. */
async function submitVerdict(page: Page, resolution: string): Promise<void> {
  await page.getByLabel(t('admin.verdict.resolution', IT)).fill(resolution);
  await page.getByRole('button', { name: t('admin.verdict.submit', IT) }).click();
  await page.waitForURL(/\/admin\?status=open/);
}

test('the seeded admin reaches the queue instead of the login screen', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: t('admin.queue.title', IT) })).toBeVisible();
  // The three status tabs are the queue's own chrome, not the layout's. `exact` because a
  // report row's accessible name ends in its own status badge — "Aperto" matches six links
  // on a queue with rows in it, and only one of them is the tab.
  for (const status of ['open', 'reviewing', 'resolved'] as const) {
    await expect(
      page.getByRole('link', { name: t(`admin.status.${status}`, IT), exact: true }),
    ).toBeVisible();
  }
});

test('the open queue lists the seeded report with its reporter', async ({ page }) => {
  await page.goto('/admin');
  const row = page.locator(`a[href="/admin/reports/${fixtures.dismissReportId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(t('admin.target.person', IT));
  await expect(row).toContainText(`@${fixtures.reporterHandle}`);
});

test('a dismissal resolves the report and lands in the audit trail', async ({ page }) => {
  const resolution = 'e2e: archiviata, nessuna violazione';
  await page.goto(`/admin/reports/${fixtures.dismissReportId}`);
  // The fieldset, by role: its legend text also occurs inside the submit button and the
  // empty-trail line, so a bare text match is three elements on this page.
  await expect(page.getByRole('group', { name: t('admin.verdict.title', IT) })).toBeVisible();
  // 'dismiss' is preselected; asserting it keeps the default honest.
  await expect(page.getByRole('radio', { name: t('admin.verdict.dismiss', IT) })).toBeChecked();
  await submitVerdict(page, resolution);

  await page.goto(`/admin/reports/${fixtures.dismissReportId}`);
  // The form is replaced by the verdict, which is how the page says it is resolved.
  await expect(page.getByRole('group', { name: t('admin.verdict.title', IT) })).toHaveCount(0);
  await expect(banner(page, 'dismissed')).toContainText(resolution);
  await expect(page.getByText(t('admin.audit.empty', IT))).toHaveCount(0);
  await expect(
    page.getByRole('listitem').filter({ hasText: t('admin.action.dismiss', IT) }),
  ).toContainText(resolution);
});

test('an upheld report records its penalty in the audit trail', async ({ page }) => {
  const resolution = 'e2e: confermata con penalità minima';
  await page.goto(`/admin/reports/${fixtures.upholdReportId}`);
  // The severity select exists only once uphold is chosen, and only for a person target.
  await expect(page.getByLabel(t('admin.verdict.severity', IT))).toHaveCount(0);
  await page.getByRole('radio', { name: t('admin.verdict.uphold', IT) }).check();
  await page
    .getByLabel(t('admin.verdict.severity', IT))
    .selectOption({ label: t('admin.severity.low', IT) });
  await submitVerdict(page, resolution);

  await page.goto(`/admin/reports/${fixtures.upholdReportId}`);
  await expect(banner(page, 'upheld')).toContainText(resolution);
  // The points are the record of the deduction the score-engine makes. Read from the weights
  // module rather than written out: rule 10 gives a weight one home, and a spec that spells
  // it a second time is the copy that gets missed when the band moves.
  await expect(page.getByRole('listitem').first()).toContainText(
    `${t('admin.action.penalty', IT)} (${reportPenaltyPoints('low')})`,
  );
});

test('the resolved tab holds both verdicts', async ({ page }) => {
  await page.goto('/admin?status=resolved');
  await expect(page.locator(`a[href="/admin/reports/${fixtures.dismissReportId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/admin/reports/${fixtures.upholdReportId}"]`)).toBeVisible();
});

test('the fund index opens a cycle audit trail', async ({ page }) => {
  await page.goto('/admin/fund');
  await expect(page.getByRole('heading', { name: t('admin.fund.title', IT) })).toBeVisible();
  const cycles = page.locator('a[href^="/admin/fund/"]');
  // Cycles are months-long objects driven by the fund's own edge functions, and this lane
  // seeds none: with an empty table the page must say so rather than render a blank list.
  if ((await cycles.count()) === 0) {
    await expect(page.getByText(t('admin.fund.empty', IT))).toBeVisible();
    test.skip(true, 'no fund cycle on this project — the index rendered its empty state');
  }
  await cycles.first().click();
  await expect(page).toHaveURL(/\/admin\/fund\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: t('admin.audit.title', IT) })).toBeVisible();
  await expect(page.getByRole('link', { name: t('admin.fund.back', IT) })).toBeVisible();
});

test('the waitlist shows the seeded signup and exports it as CSV', async ({ page }) => {
  await page.goto('/admin/waitlist');
  await expect(page.getByRole('heading', { name: t('admin.waitlist.title', IT) })).toBeVisible();
  await expect(page.getByRole('cell', { name: fixtures.waitlistEmail })).toBeVisible();

  // Fetched rather than navigated: the route answers with a Content-Disposition attachment,
  // which a page navigation turns into a download instead of a response to assert on.
  // `page.request` carries the context's cookies, so this is the same admin session.
  const csv = await page.request.get('/admin/waitlist/export');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.split('\r\n')[0]).toBe('email,locale,source,created_at');
  expect(body).toContain(`"${fixtures.waitlistEmail}"`);
});
