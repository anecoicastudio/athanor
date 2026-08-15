// deno test supabase/functions/create-payout-onboarding/ — runs in CI (edge job) and locally.
// Characterization tests for the Connect Express onboarding: config + identity gates,
// create vs reuse, the UNIQUE-backstopped race, and the Account Link params.
// All db I/O through injected fakes; Stripe as capability closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  buildPayoutAccountParams,
  buildPayoutLinkParams,
  createPayoutOnboarding,
  type PayoutOnboardingCtx,
} from './logic.ts';

const PROFILE = 'prof-1';
const EMAIL = 'seeker@example.com';
const URLS = {
  returnUrl: 'https://athanor.example/payout/return',
  refreshUrl: 'https://athanor.example/payout/refresh',
};

type Ctx = PayoutOnboardingCtx & {
  userDb: FakeDb;
  adminDb: FakeDb;
  accountsCreated: Stripe.AccountCreateParams[];
  linksCreated: Stripe.AccountLinkCreateParams[];
  accountsDeleted: string[];
};

const ctx = (
  script: { user?: Record<string, FakeResult[]>; admin?: Record<string, FakeResult[]> } = {},
  opts: {
    urls?: PayoutOnboardingCtx['urls'];
    linkUrl?: string | null;
    throwOnAccount?: boolean;
    throwOnLink?: boolean;
    throwOnDelete?: boolean;
  } = {},
): Ctx => {
  const userDb = makeFakeDb(script.user);
  const adminDb = makeFakeDb(script.admin);
  const accountsCreated: Stripe.AccountCreateParams[] = [];
  const linksCreated: Stripe.AccountLinkCreateParams[] = [];
  const accountsDeleted: string[] = [];
  return {
    userClient: userDb as unknown as PayoutOnboardingCtx['userClient'],
    admin: adminDb as unknown as PayoutOnboardingCtx['admin'],
    createAccount: (params) => {
      accountsCreated.push(params);
      if (opts.throwOnAccount) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({ id: 'acct_new' } as Stripe.Account);
    },
    createAccountLink: (params) => {
      linksCreated.push(params);
      if (opts.throwOnLink) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        url: opts.linkUrl === undefined ? 'https://connect.stripe.test/setup/1' : opts.linkUrl,
      } as Stripe.AccountLink);
    },
    deleteAccount: (id) => {
      accountsDeleted.push(id);
      if (opts.throwOnDelete) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({});
    },
    urls: opts.urls ?? URLS,
    userDb,
    adminDb,
    accountsCreated,
    linksCreated,
    accountsDeleted,
  };
};

/** Script shorthand: identity verified + no existing row (the create path's precondition). */
const verifiedNoRow = (over: Record<string, FakeResult[]> = {}) => ({
  user: {
    'rpc.is_identity_verified': [{ data: true }],
    'payout_accounts.select': [{ data: null }],
    ...over,
  },
});

const run = async (c: Ctx) => {
  const res = await createPayoutOnboarding(c, { profileId: PROFILE, email: EMAIL });
  return { res, body: await res.json() };
};

// ── config + identity gates ──────────────────────────────────────────────────

Deno.test('missing return/refresh env → 500 "not configured", nothing touched', async () => {
  for (const urls of [
    {},
    { returnUrl: URLS.returnUrl },
    { refreshUrl: URLS.refreshUrl },
  ] as PayoutOnboardingCtx['urls'][]) {
    const c = ctx({}, { urls });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'payout onboarding not configured' });
    assertEquals(c.userDb.calls.length, 0);
    assertEquals(c.accountsCreated.length, 0);
  }
});

Deno.test('unverified caller → 403, no Stripe call, no row', async () => {
  const c = ctx({ user: { 'rpc.is_identity_verified': [{ data: false }] } });
  const { res, body } = await run(c);
  assertEquals(res.status, 403);
  assertEquals(body, { error: 'identity not verified' });
  assertEquals(c.accountsCreated.length, 0);
  assertEquals(c.adminDb.calls.length, 0);
});

Deno.test('identity lookup error → 500 fail-closed, never onboards unverifiable', async () => {
  const c = ctx({ user: { 'rpc.is_identity_verified': [{ error: { message: 'boom' } }] } });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'verification lookup failed' });
  assertEquals(c.accountsCreated.length, 0);
});

Deno.test('payout_accounts lookup error → 500, no account created', async () => {
  const c = ctx({
    user: {
      'rpc.is_identity_verified': [{ data: true }],
      'payout_accounts.select': [{ error: { message: 'boom' } }],
    },
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'payout account lookup failed' });
  assertEquals(c.accountsCreated.length, 0);
});

// ── create path ──────────────────────────────────────────────────────────────

Deno.test('no row → Express account created, row inserted, link returned', async () => {
  const c = ctx(verifiedNoRow());
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://connect.stripe.test/setup/1' });

  // Controller properties, not the deprecated type shorthand; transfers only; identity from
  // the verified caller.
  assertEquals(c.accountsCreated, [
    {
      controller: {
        stripe_dashboard: { type: 'express' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
      },
      capabilities: { transfers: { requested: true } },
      metadata: { profile_id: PROFILE },
      email: EMAIL,
    },
  ]);

  // The one service-role write: the pointer row. Flags stay at their defaults — the webhook
  // owns them.
  const insert = c.adminDb.calls.find((call) => call.op === 'insert');
  assertEquals(insert?.table, 'payout_accounts');
  assertEquals(insert?.values, { profile_id: PROFILE, stripe_account_id: 'acct_new' });

  assertEquals(c.linksCreated, [
    {
      account: 'acct_new',
      return_url: URLS.returnUrl,
      refresh_url: URLS.refreshUrl,
      type: 'account_onboarding',
      collection_options: { fields: 'eventually_due' },
    },
  ]);
  assertEquals(c.accountsDeleted.length, 0);
});

Deno.test('own-row read rides the caller RLS: select-own filter shape', async () => {
  const c = ctx(verifiedNoRow());
  await run(c);
  const select = c.userDb.calls.find((call) => call.table === 'payout_accounts');
  assertEquals(select?.filters, [['eq', 'profile_id', PROFILE]]);
  assertEquals(select?.terminal, 'maybeSingle');
});

Deno.test('createAccount throw → clean 500, never Stripe internals, no row', async () => {
  const c = ctx(verifiedNoRow(), { throwOnAccount: true });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not start payout onboarding' });
  assertEquals(c.adminDb.calls.length, 0);
  assertEquals(c.linksCreated.length, 0);
});

// ── reuse path ───────────────────────────────────────────────────────────────

Deno.test('existing row → no new account, fresh link for the stored account', async () => {
  const c = ctx({
    user: {
      'rpc.is_identity_verified': [{ data: true }],
      'payout_accounts.select': [{ data: { stripe_account_id: 'acct_old' } }],
    },
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://connect.stripe.test/setup/1' });
  assertEquals(c.accountsCreated.length, 0);
  assertEquals(c.adminDb.calls.length, 0);
  assertEquals(c.linksCreated[0].account, 'acct_old');
});

// ── race path ────────────────────────────────────────────────────────────────

Deno.test('insert loses the race (23505) → loser deleted, link for the winner', async () => {
  const c = ctx({
    user: verifiedNoRow().user,
    admin: {
      'payout_accounts.insert': [{ error: { code: '23505', message: 'duplicate' } }],
      'payout_accounts.select': [{ data: { stripe_account_id: 'acct_winner' } }],
    },
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://connect.stripe.test/setup/1' });
  assertEquals(c.accountsDeleted, ['acct_new']);
  assertEquals(c.linksCreated[0].account, 'acct_winner');
});

Deno.test('race re-read failing or empty → 500, no link minted', async () => {
  for (const reRead of [{ error: { message: 'boom' } }, { data: null }] as FakeResult[]) {
    const c = ctx({
      user: verifiedNoRow().user,
      admin: {
        'payout_accounts.insert': [{ error: { code: '23505', message: 'duplicate' } }],
        'payout_accounts.select': [reRead],
      },
    });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'payout account lookup failed' });
    assertEquals(c.linksCreated.length, 0);
  }
});

Deno.test('non-unique insert error → 500, orphan account still cleaned up', async () => {
  const c = ctx({
    user: verifiedNoRow().user,
    admin: { 'payout_accounts.insert': [{ error: { code: '57014', message: 'timeout' } }] },
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not save payout account' });
  assertEquals(c.accountsDeleted, ['acct_new']);
  assertEquals(c.linksCreated.length, 0);
});

Deno.test('cleanup delete throwing never masks the outcome', async () => {
  const c = ctx(
    {
      user: verifiedNoRow().user,
      admin: {
        'payout_accounts.insert': [{ error: { code: '23505', message: 'duplicate' } }],
        'payout_accounts.select': [{ data: { stripe_account_id: 'acct_winner' } }],
      },
    },
    { throwOnDelete: true },
  );
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://connect.stripe.test/setup/1' });
  assertEquals(c.linksCreated[0].account, 'acct_winner');
});

// ── link failures ────────────────────────────────────────────────────────────

Deno.test('a link without a url → 500 rather than a broken redirect', async () => {
  for (const linkUrl of [null, '']) {
    const c = ctx(verifiedNoRow(), { linkUrl });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'could not start payout onboarding' });
  }
});

Deno.test('link create throw → clean 500, never Stripe internals', async () => {
  const c = ctx(verifiedNoRow(), { throwOnLink: true });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not start payout onboarding' });
});

// ── params builders ──────────────────────────────────────────────────────────

Deno.test('buildPayoutAccountParams is pure; identity has one entry point', () => {
  const a = buildPayoutAccountParams('someone-else', undefined);
  assertEquals(a.metadata, { profile_id: 'someone-else' });
  assertEquals(a.email, undefined);
  assert(!('type' in a), 'deprecated account type shorthand must not appear');
  assertEquals(buildPayoutAccountParams(PROFILE, EMAIL), buildPayoutAccountParams(PROFILE, EMAIL));
});

Deno.test('buildPayoutLinkParams is pure and deterministic', () => {
  const a = buildPayoutLinkParams('acct_1', URLS.returnUrl, URLS.refreshUrl);
  assertEquals(a, buildPayoutLinkParams('acct_1', URLS.returnUrl, URLS.refreshUrl));
  assertEquals(a.type, 'account_onboarding');
});
