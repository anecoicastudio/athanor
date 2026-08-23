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
 * Fixtures are ours alone, and namespaced per run: a disposable subject, a disposable
 * reporter, two reports against that subject, one waitlist row. The verdict specs resolve OUR
 * reports, never one of the twelve staging personas' — `resolve_report` writes the audit log
 * and, on an uphold, enqueues a real Aura penalty. Nothing here reads the hourly
 * `staging-refresh-world` rows.
 *
 *   node --experimental-strip-types e2e/seed/seed-admin.mts             # seed
 *   node --experimental-strip-types e2e/seed/seed-admin.mts --teardown  # remove it all
 *
 * Seeding is idempotent: it purges this run's namespace before creating it, and sweeps any
 * other run's fixtures older than six hours, so a failed teardown costs the next run nothing.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@athanor/api';
import { config as loadEnv } from 'dotenv';

/** Every client here is schema-typed, so a renamed column fails `pnpm typecheck` rather than
 *  the e2e run that depends on it. */
type Client = SupabaseClient<Database>;

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
const AUTH_DIR = resolve(WEB_ROOT, 'e2e/.auth');
const STATE_FILE = resolve(AUTH_DIR, 'admin.json');
const FIXTURES_FILE = resolve(AUTH_DIR, 'fixtures.json');

// The URL and the publishable key are public and may come from .env.local, exactly as the
// dev server reads them. The secret key may NOT — it is read from the process env only, and
// this file never writes it anywhere.
loadEnv({ path: resolve(WEB_ROOT, '.env.local') });

/**
 * Fixtures are namespaced per run, because two of these run at once.
 *
 * The repo lands several PRs in parallel and every one of them touching `apps/web` gets its
 * own e2e job against the SAME staging project. Shared fixture names would make each run's
 * purge delete the other run's admin mid-suite, and the victim would fail by redirecting to
 * the login screen — a flake with no visible cause. `GITHUB_RUN_ID` is unique per run and
 * stable across a re-run's attempts; a local run gets `local`, so repeated local runs reuse
 * and purge one namespace rather than piling up.
 */
const RUN_TAG =
  (process.env.E2E_RUN_TAG ?? process.env.GITHUB_RUN_ID ?? 'local')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'local';

/** `.test` is reserved by RFC 2606: these addresses cannot resolve, so no mail can escape. */
const EMAIL_SUFFIX = '@athanor.test';
const email = (role: string) => `e2e-${RUN_TAG}-${role}${EMAIL_SUFFIX}`;
/** `profiles.handle` is `^[a-z0-9_]{3,30}$`; a 16-char tag leaves this at 29 at the longest. */
const handle = (role: string) => `e2e_${RUN_TAG}_${role}`;

const ADMIN_EMAIL = email('admin');
const REPORTER_EMAIL = email('reporter');
const SUBJECT_EMAIL = email('subject');
const WAITLIST_EMAIL = email('waitlist');
const REPORTER_HANDLE = handle('reporter');
const SUBJECT_HANDLE = handle('subject');
/** Every account this run owns. Teardown deletes exactly these. */
const OWNED_EMAILS = [ADMIN_EMAIL, REPORTER_EMAIL, SUBJECT_EMAIL];

/** Matches any run's accounts, this one's included — the stale sweep's net. */
const ANY_RUN_EMAIL = /^e2e-[a-z0-9]+-(admin|reporter|subject)@athanor\.test$/;
/**
 * How old another run's fixtures must be before this one removes them. The e2e job is capped
 * at 23 minutes, so six hours cannot reach a live run — anything older lost its teardown.
 */
const STALE_MS = 6 * 60 * 60 * 1000;

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

/** The only project this script may write to. */
const STAGING_REF = 'eralyiwkfrpqsawivegz';
/** Named in the refusal so the message says what went wrong, not just that something did. */
const PRODUCTION_REF = 'kwzeiqvrnnaagccyoose';

/**
 * The Supabase URL, refused unless it is staging's.
 *
 * This is not paranoia, it is the near miss that produced it: CI's `NEXT_PUBLIC_SUPABASE_URL`
 * secret is PRODUCTION's — the same one `web-build` and `deploy` use to build the live site —
 * so the first CI run of this script was handed production's URL with staging's secret key.
 * It failed on "Invalid API key", which is luck, not a safeguard: had the keys matched, this
 * script would have created an admin and fixtures in production and resolved reports there.
 * The e2e job now maps a dedicated staging trio onto these names, and this guard is what makes
 * that mapping's failure loud instead of destructive.
 */
function stagingUrl(): string {
  const raw = required('NEXT_PUBLIC_SUPABASE_URL');
  const ref = new URL(raw).hostname.split('.')[0];
  if (ref !== STAGING_REF) {
    throw new Error(
      `refusing to run against project "${ref}" — this script only ever writes to staging ` +
        `(${STAGING_REF}). Production is ${PRODUCTION_REF}. Point NEXT_PUBLIC_SUPABASE_URL at ` +
        `staging (in CI: the E2E_SUPABASE_URL secret).`,
    );
  }
  return raw;
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

function serviceClient(): Client {
  // stagingUrl() before anything else: it is the gate, and both seed() and teardown() open
  // with this call, so no write can precede it.
  return createClient<Database>(stagingUrl(), required('E2E_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The admin API has no lookup-by-email and no filter, so page the list and match locally. */
async function eachUser(admin: Client, visit: (user: User) => void): Promise<void> {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    data.users.forEach(visit);
    if (data.users.length < perPage) return;
  }
}

async function usersByEmail(admin: Client, emails: string[]): Promise<Map<string, User>> {
  const wanted = new Set(emails);
  const found = new Map<string, User>();
  await eachUser(admin, (user) => {
    if (user.email && wanted.has(user.email)) found.set(user.email, user);
  });
  return found;
}

/** Fixture accounts belonging to ANY run, this one included. */
async function allFixtureUsers(admin: Client): Promise<User[]> {
  const found: User[] = [];
  await eachUser(admin, (user) => {
    if (user.email && ANY_RUN_EMAIL.test(user.email)) found.push(user);
  });
  return found;
}

/**
 * Delete this run's accounts and waitlist row, plus anything an older run abandoned.
 *
 * `profiles.id` cascades from `auth.users`, and `reports.reporter_id` cascades from
 * `profiles`, so deleting the fixture accounts takes their reports and audit rows with them.
 * The admin goes too, so a torn-down staging carries nothing of ours at all.
 *
 * The stale half exists because a killed job never reaches its teardown step. It is bounded
 * by age rather than by namespace precisely so it cannot touch a run that is still going.
 */
async function purge(admin: Client): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_MS);
  const doomed = new Map<string, string>();

  const mine = await usersByEmail(admin, OWNED_EMAILS);
  for (const [address, user] of mine) doomed.set(address, user.id);

  let stale = 0;
  for (const user of await allFixtureUsers(admin)) {
    if (!user.email || doomed.has(user.email)) continue;
    if (new Date(user.created_at) >= staleBefore) continue;
    doomed.set(user.email, user.id);
    stale += 1;
  }

  for (const [address, id] of doomed) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`could not delete ${address}: ${error.message}`);
  }

  const { error } = await admin.from('email_waitlist').delete().eq('email', WAITLIST_EMAIL);
  if (error) throw error;
  const { error: staleError } = await admin
    .from('email_waitlist')
    .delete()
    .like('email', 'e2e-%@athanor.test')
    .lt('created_at', staleBefore.toISOString());
  if (staleError) throw staleError;

  rmSync(STATE_FILE, { force: true });
  rmSync(FIXTURES_FILE, { force: true });
  console.log(`[seed] purged ${doomed.size} fixture account(s) (${stale} from an earlier run)`);
}

async function createConfirmedUser(
  admin: Client,
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
async function setHandle(admin: Client, id: string, value: string): Promise<void> {
  const { error } = await admin.from('profiles').update({ handle: value }).eq('id', id);
  if (error) throw error;
}

async function insertReport(
  admin: Client,
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
  return data.id;
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
async function mintStorageState(admin: Client, address: string): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: address,
  });
  if (error || !data.properties) throw new Error(`generateLink failed: ${error?.message}`);
  const { hashed_token: tokenHash, verification_type: verificationType } = data.properties;

  const captured: { name: string; value: string; options: CookieOptions }[] = [];
  const ssr = createServerClient<Database>(stagingUrl(), publicKey(), {
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
      // expiry the app would have set. `!= null`, not a truthiness test: `@supabase/ssr`
      // spells a cookie REMOVAL as maxAge 0, and a falsy check would write that back as a
      // live session cookie with no expiry at all.
      expires: options.maxAge != null ? nowSeconds + options.maxAge : -1,
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

// `admin-authenticated.spec.ts` imports the `Fixtures` type from this file. That import is
// erased before it runs, but this guard means an accidental VALUE import would not quietly
// seed staging — or set a failing exit code — from inside the test process.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const isTeardown = process.argv.includes('--teardown');
  try {
    await (isTeardown ? teardown() : seed());
  } catch (e) {
    // The message, never the error object: a Supabase client error can carry the request it
    // made, and that request carries the key.
    console.error(`[seed] ${isTeardown ? 'teardown' : 'seed'} failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
