/**
 * Authenticated-e2e seeding for the web admin panel (#174).
 *
 * Runs as its OWN process, never inside `playwright test`. That is the whole point: the
 * Playwright config's `webServer` starts `pnpm dev` with the Playwright process's env, so a
 * secret exported around `playwright test` would be readable by the Next dev server. The
 * `sb_secret_…` key therefore lives here and nowhere else (supabase/ENV-NOTES.md), and what
 * crosses to the test run is two gitignored files under `e2e/.auth/`:
 *
 *   admin.json     — a Playwright storageState carrying the seeded admin's session cookies
 *   fixtures.json  — the ids/handles/emails the specs assert against. No tokens, no keys.
 *
 * Session minting takes the magic-link token, not a password and not a browser: an admin
 * `generateLink` yields a `hashed_token`, and `verifyOtp` redeems it through a
 * `@supabase/ssr` server client whose cookie adapter captures what it writes. The cookies
 * are produced by the same library the app uses, so their names, chunking and encoding are
 * the app's rather than a guess. Nothing test-only is added to the admin panel — in
 * particular `app/admin/auth/callback/route.ts` stays PKCE-`code`-only.
 *
 * Fixtures are ours alone: a disposable subject, a disposable reporter, two reports against
 * that subject, one waitlist row. The verdict specs resolve OUR reports, never one of the
 * twelve staging personas' — `resolve_report` writes the audit log and, on an uphold,
 * enqueues a real Aura penalty. Nothing here reads the hourly `staging-refresh-world` rows.
 *
 *   node --experimental-strip-types e2e/seed/seed-admin.mts             # seed
 *   node --experimental-strip-types e2e/seed/seed-admin.mts --teardown  # remove it all
 *
 * Seeding is idempotent: it purges any leftover fixture from a crashed run before creating
 * this one, so a failed teardown costs the next run nothing.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { config as loadEnv } from 'dotenv';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
const AUTH_DIR = resolve(WEB_ROOT, 'e2e/.auth');
const STATE_FILE = resolve(AUTH_DIR, 'admin.json');
const FIXTURES_FILE = resolve(AUTH_DIR, 'fixtures.json');

// The URL and the publishable key are public and may come from .env.local, exactly as the
// dev server reads them. The secret key may NOT — it is read from the process env only, and
// this file never writes it anywhere.
loadEnv({ path: resolve(WEB_ROOT, '.env.local') });

/** `.test` is reserved by RFC 2606: these addresses cannot resolve, so no mail can escape. */
const ADMIN_EMAIL = 'e2e-admin@athanor.test';
const REPORTER_EMAIL = 'e2e-fixture-reporter@athanor.test';
const SUBJECT_EMAIL = 'e2e-fixture-subject@athanor.test';
const WAITLIST_EMAIL = 'e2e-fixture-waitlist@athanor.test';
const REPORTER_HANDLE = 'e2e_fixture_reporter';
const SUBJECT_HANDLE = 'e2e_fixture_subject';
/** Every account this script owns. Teardown deletes exactly these and nothing else. */
const OWNED_EMAILS = [ADMIN_EMAIL, REPORTER_EMAIL, SUBJECT_EMAIL];

export type Fixtures = {
  adminEmail: string;
  reporterId: string;
  reporterHandle: string;
  subjectId: string;
  subjectHandle: string;
  /** Resolved with `dismiss` — no Aura, no enforcement, an audit row is the whole outcome. */
  dismissReportId: string;
  /** Resolved with `uphold` + severity → a real penalty, against our own disposable subject. */
  upholdReportId: string;
  waitlistEmail: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see supabase/ENV-NOTES.md`);
  return value;
}

function publicKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set',
    );
  }
  return key;
}

function serviceClient(): SupabaseClient {
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('E2E_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The admin API has no lookup-by-email, so page the list and match. */
async function usersByEmail(admin: SupabaseClient, emails: string[]): Promise<Map<string, User>> {
  const wanted = new Set(emails);
  const found = new Map<string, User>();
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email && wanted.has(user.email)) found.set(user.email, user);
    }
    if (data.users.length < perPage) return found;
  }
}

/**
 * Delete every account this script owns, and the waitlist row.
 *
 * `profiles.id` cascades from `auth.users`, and `reports.reporter_id` cascades from
 * `profiles`, so deleting the two fixture accounts takes their reports and audit rows with
 * them. Deleting the admin too means a torn-down staging carries nothing of ours at all.
 */
async function purge(admin: SupabaseClient): Promise<void> {
  const existing = await usersByEmail(admin, OWNED_EMAILS);
  for (const [email, user] of existing) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`could not delete ${email}: ${error.message}`);
  }
  const { error } = await admin.from('email_waitlist').delete().eq('email', WAITLIST_EMAIL);
  if (error) throw error;
  rmSync(STATE_FILE, { force: true });
  rmSync(FIXTURES_FILE, { force: true });
  console.log(`[seed] purged ${existing.size} fixture account(s)`);
}

async function createConfirmedUser(
  admin: SupabaseClient,
  email: string,
  appMetadata: Record<string, unknown> = {},
): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  return data.user;
}

/** A handle makes the fixture legible in the queue; `handle_new_user` leaves it null. */
async function setHandle(admin: SupabaseClient, id: string, handle: string): Promise<void> {
  const { error } = await admin.from('profiles').update({ handle }).eq('id', id);
  if (error) throw error;
}

async function insertReport(
  admin: SupabaseClient,
  row: { reporterId: string; subjectId: string; category: string; note: string },
): Promise<string> {
  const { data, error } = await admin
    .from('reports')
    .insert({
      reporter_id: row.reporterId,
      target_type: 'person',
      target_id: row.subjectId,
      category: row.category,
      note: row.note,
      status: 'open',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Mint the admin's session as Playwright storage state.
 *
 * `generateLink` never sends mail — it returns the one-time token directly — and `verifyOtp`
 * redeems it on a publishable-key client, so the cookies written are the ones a real
 * sign-in would write. Capturing them through `@supabase/ssr` rather than composing them by
 * hand is deliberate: the chunk suffixes and the `base64-` value encoding are the library's
 * business, and a hand-rolled copy would drift the first time it changed.
 */
async function mintStorageState(admin: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data.properties) throw new Error(`generateLink failed: ${error?.message}`);
  const { hashed_token: tokenHash, verification_type: verificationType } = data.properties;

  const captured: { name: string; value: string; options: CookieOptions }[] = [];
  const ssr = createServerClient(required('NEXT_PUBLIC_SUPABASE_URL'), publicKey(), {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        captured.push(...cookies);
      },
    },
  });
  const { error: otpError } = await ssr.auth.verifyOtp({
    token_hash: tokenHash,
    type: verificationType as 'magiclink',
  });
  if (otpError) throw new Error(`verifyOtp failed: ${otpError.message}`);
  if (captured.length === 0) throw new Error('verifyOtp wrote no cookies — nothing to save');

  const baseURL = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const state = {
    cookies: captured.map(({ name, value, options }) => ({
      name,
      value,
      domain: baseURL.hostname,
      path: options.path ?? '/',
      // A session cookie (-1) would survive the run either way; honouring maxAge keeps the
      // expiry the app would have set.
      expires: options.maxAge ? nowSeconds + options.maxAge : -1,
      // Not httpOnly by default, and that matters: components/session-keepalive.tsx reads
      // the session from the browser client.
      httpOnly: options.httpOnly ?? false,
      secure: baseURL.protocol === 'https:',
      sameSite: 'Lax' as const,
    })),
    origins: [],
  };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`[seed] wrote ${state.cookies.length} session cookie(s) to e2e/.auth/admin.json`);
}

async function seed(): Promise<void> {
  const admin = serviceClient();
  await purge(admin);

  const adminUser = await createConfirmedUser(admin, ADMIN_EMAIL, { role: 'admin' });
  // Assert rather than trust: `athanor.is_admin()` reads the JWT's app_metadata, so a role
  // that did not land would fail every spec below with a redirect and no explanation.
  if ((adminUser.app_metadata as { role?: string }).role !== 'admin') {
    throw new Error(`${ADMIN_EMAIL} was created without app_metadata.role='admin'`);
  }

  const reporter = await createConfirmedUser(admin, REPORTER_EMAIL);
  const subject = await createConfirmedUser(admin, SUBJECT_EMAIL);
  await setHandle(admin, reporter.id, REPORTER_HANDLE);
  await setHandle(admin, subject.id, SUBJECT_HANDLE);

  const dismissReportId = await insertReport(admin, {
    reporterId: reporter.id,
    subjectId: subject.id,
    category: 'spam',
    note: 'e2e fixture — resolved with a dismissal',
  });
  const upholdReportId = await insertReport(admin, {
    reporterId: reporter.id,
    subjectId: subject.id,
    category: 'harassment',
    note: 'e2e fixture — resolved with an upheld penalty',
  });

  const { error: waitlistError } = await admin
    .from('email_waitlist')
    .insert({ email: WAITLIST_EMAIL, locale: 'it', source: 'e2e' });
  if (waitlistError) throw waitlistError;

  await mintStorageState(admin, ADMIN_EMAIL);

  const fixtures: Fixtures = {
    adminEmail: ADMIN_EMAIL,
    reporterId: reporter.id,
    reporterHandle: REPORTER_HANDLE,
    subjectId: subject.id,
    subjectHandle: SUBJECT_HANDLE,
    dismissReportId,
    upholdReportId,
    waitlistEmail: WAITLIST_EMAIL,
  };
  writeFileSync(FIXTURES_FILE, `${JSON.stringify(fixtures, null, 2)}\n`);
  console.log('[seed] fixtures written to e2e/.auth/fixtures.json');
}

async function teardown(): Promise<void> {
  await purge(serviceClient());
}

const isTeardown = process.argv.includes('--teardown');
try {
  await (isTeardown ? teardown() : seed());
} catch (e) {
  // The message, never the error object: a Supabase client error can carry the request it
  // made, and that request carries the key.
  console.error(`[seed] ${isTeardown ? 'teardown' : 'seed'} failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
