// deno test supabase/functions/create-circle-portal/ — runs in CI (edge job) and locally.
// Characterization tests for the portal membership gate + params.
// All db I/O through injected fakes; Stripe as a capability closure (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { createCirclePortal, type CirclePortalCtx } from './logic.ts';

const PROFILE = 'prof-1';

type Ctx = CirclePortalCtx & {
  db: FakeDb;
  created: Stripe.BillingPortal.SessionCreateParams[];
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: { throwOnCreate?: boolean } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const created: Stripe.BillingPortal.SessionCreateParams[] = [];
  return {
    userClient: db as unknown as CirclePortalCtx['userClient'],
    createPortalSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        url: 'https://billing.stripe.test/ps_1',
      } as Stripe.BillingPortal.Session);
    },
    appBase: 'athanor://',
    db,
    created,
  };
};

const run = async (c: Ctx) => {
  const res = await createCirclePortal(c, { profileId: PROFILE });
  return { res, body: await res.json() };
};

Deno.test('membership lookup error → 500', async () => {
  const c = ctx({ 'circle_memberships.select': [{ error: { message: 'boom' } }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'membership lookup failed' });
  assertEquals(c.created.length, 0);
});

Deno.test('no membership row / null customer id → 404, Stripe never called', async () => {
  for (const scripted of [{ data: null }, { data: { stripe_customer_id: null } }]) {
    const c = ctx({ 'circle_memberships.select': [scripted] });
    const { res, body } = await run(c);
    assertEquals(res.status, 404);
    assertEquals(body, { error: 'no membership' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('happy path → { url }; own-row read, portal params shape', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] });
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://billing.stripe.test/ps_1' });

  // membership read is scoped to the caller (RLS select-own mirrors this).
  const q = c.db.calls[0];
  assertEquals(q.table, 'circle_memberships');
  assertEquals(q.columns, 'stripe_customer_id');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'profile_id' && v === PROFILE));

  assertEquals(c.created, [{ customer: 'cus_1', return_url: 'athanor://circle?portal=return' }]);
});

Deno.test('portal create throw → clean 500, never Stripe internals', async () => {
  const c = ctx(
    { 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] },
    { throwOnCreate: true },
  );
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not open portal' });
});
