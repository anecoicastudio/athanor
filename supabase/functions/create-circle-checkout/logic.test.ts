// deno test supabase/functions/create-circle-checkout/ — runs in CI (edge job) and locally.
// Characterization tests for the circle subscription checkout: plan/price gates,
// customer reuse vs create, and the dual-metadata session params.
// All db I/O through injected fakes; Stripe as capability closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { createCircleCheckout, isCirclePlan, type CircleCheckoutCtx } from './logic.ts';

const PROFILE = 'prof-1';
const EMAIL = 'seeker@example.com';
const PRICES = { monthly: 'price_month_1', annual: 'price_year_1' };

type Ctx = CircleCheckoutCtx & {
  db: FakeDb;
  customersCreated: Stripe.CustomerCreateParams[];
  sessionsCreated: Stripe.Checkout.SessionCreateParams[];
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: {
    priceIds?: CircleCheckoutCtx['priceIds'];
    sessionUrl?: string | null;
    throwOnCustomer?: boolean;
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const sessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
  return {
    userClient: db as unknown as CircleCheckoutCtx['userClient'],
    createCustomer: (params) => {
      customersCreated.push(params);
      if (opts.throwOnCustomer) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({ id: 'cus_new' } as Stripe.Customer);
    },
    createCheckoutSession: (params) => {
      sessionsCreated.push(params);
      return Promise.resolve({
        url: opts.sessionUrl === undefined ? 'https://checkout.stripe.test/cs_1' : opts.sessionUrl,
      } as Stripe.Checkout.Session);
    },
    priceIds: opts.priceIds ?? PRICES,
    appBase: 'athanor://',
    db,
    customersCreated,
    sessionsCreated,
  };
};

const run = async (c: Ctx, plan: string) => {
  const res = await createCircleCheckout(c, { profileId: PROFILE, email: EMAIL, plan });
  return { res, body: await res.json() };
};

// ── plan + price gates ───────────────────────────────────────────────────────

Deno.test('isCirclePlan: only the two plan literals pass', () => {
  assertEquals(isCirclePlan('monthly'), true);
  assertEquals(isCirclePlan('annual'), true);
  assertEquals(isCirclePlan('weekly'), false);
  assertEquals(isCirclePlan(''), false);
  assertEquals(isCirclePlan(undefined), false);
  assertEquals(isCirclePlan(null), false);
});

Deno.test('invalid plan → 400, nothing touched', async () => {
  const c = ctx();
  const { res, body } = await run(c, 'weekly');
  assertEquals(res.status, 400);
  assertEquals(body, { error: 'plan must be monthly or annual' });
  assertEquals(c.db.calls.length, 0);
  assertEquals(c.customersCreated.length, 0);
  assertEquals(c.sessionsCreated.length, 0);
});

Deno.test('missing price env → 500 "price not configured", db never queried', async () => {
  const noMonthly = ctx({}, { priceIds: { annual: PRICES.annual } });
  const m = await run(noMonthly, 'monthly');
  assertEquals(m.res.status, 500);
  assertEquals(m.body, { error: 'price not configured' });
  assertEquals(noMonthly.db.calls.length, 0);

  const noAnnual = ctx({}, { priceIds: { monthly: PRICES.monthly } });
  const a = await run(noAnnual, 'annual');
  assertEquals(a.res.status, 500);
  assertEquals(a.body, { error: 'price not configured' });
});

// ── customer reuse vs create ─────────────────────────────────────────────────

Deno.test('existing membership → Customer reused, createCustomer never called', async () => {
  const c = ctx({
    'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_existing' } }],
  });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(body, { kind: 'url', url: 'https://checkout.stripe.test/cs_1' });

  assertEquals(c.customersCreated.length, 0);
  assertEquals(c.sessionsCreated[0].customer, 'cus_existing');

  // membership read is scoped to the caller (RLS select-own mirrors this).
  const q = c.db.calls[0];
  assertEquals(q.table, 'circle_memberships');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'profile_id' && v === PROFILE));
});

Deno.test('no membership → Customer created with email + profile_id tag, then used', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: null }] });
  const { res } = await run(c, 'annual');
  assertEquals(res.status, 200);

  assertEquals(c.customersCreated, [{ email: EMAIL, metadata: { profile_id: PROFILE } }]);
  assertEquals(c.sessionsCreated[0].customer, 'cus_new');
});

// ── session params ───────────────────────────────────────────────────────────

Deno.test(
  'subscription params: injected Price ID per plan, dual metadata, no amounts',
  async () => {
    for (const [plan, priceId] of [
      ['monthly', PRICES.monthly],
      ['annual', PRICES.annual],
    ] as const) {
      const c = ctx({
        'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }],
      });
      await run(c, plan);
      const params = c.sessionsCreated[0];
      assertEquals(params.mode, 'subscription');
      // Only the pre-configured Price ID — no client-supplied or hardcoded amounts (rule #6).
      assertEquals(params.line_items, [{ price: priceId, quantity: 1 }]);
      // Dual metadata: top-level kind routes W11; subscription_data.metadata rides W5/W6/W7.
      assertEquals(params.metadata, { kind: 'subscription', profile_id: PROFILE });
      assertEquals(params.subscription_data, { metadata: { profile_id: PROFILE } });
      assertEquals(params.success_url, 'athanor://circle?checkout=success');
      assertEquals(params.cancel_url, 'athanor://circle?checkout=cancel');
    }
  },
);

// ── failure paths ────────────────────────────────────────────────────────────

Deno.test('session without url / customer create throw → clean 500', async () => {
  const noUrl = ctx(
    { 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] },
    { sessionUrl: null },
  );
  const n = await run(noUrl, 'monthly');
  assertEquals(n.res.status, 500);
  assertEquals(n.body, { error: 'could not start checkout' });

  const thrown = ctx({ 'circle_memberships.select': [{ data: null }] }, { throwOnCustomer: true });
  const t = await run(thrown, 'monthly');
  assertEquals(t.res.status, 500);
  assertEquals(t.body, { error: 'could not start checkout' });
  assertEquals(thrown.sessionsCreated.length, 0);
});
