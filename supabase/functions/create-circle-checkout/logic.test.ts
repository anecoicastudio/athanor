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
  pricesRetrieved: string[];
  refusals: string[];
};

/** A Stripe Price as the two Circle ids actually resolve today (sandbox, 2026-09-03). */
const price = (over: Partial<Stripe.Price> = {}): Stripe.Price =>
  ({
    id: PRICES.monthly,
    object: 'price',
    active: true,
    currency: 'eur',
    unit_amount: 1200,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    ...over,
  }) as unknown as Stripe.Price;

const yearly = { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'];

/** The Price each id resolves to by default — the live pair, on their own intervals. */
const LIVE_PRICES: Record<string, Stripe.Price | Error> = {
  [PRICES.monthly]: price(),
  [PRICES.annual]: price({ id: PRICES.annual, unit_amount: 9900, recurring: yearly }),
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: {
    priceIds?: CircleCheckoutCtx['priceIds'];
    prices?: Record<string, Stripe.Price | Error>;
    sessionUrl?: string | null;
    throwOnCustomer?: boolean;
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const sessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
  const pricesRetrieved: string[] = [];
  const refusals: string[] = [];
  const prices = opts.prices ?? LIVE_PRICES;
  return {
    userClient: db as unknown as CircleCheckoutCtx['userClient'],
    retrievePrice: (id) => {
      pricesRetrieved.push(id);
      const found = prices[id];
      if (found instanceof Error) return Promise.reject(found);
      if (!found) return Promise.reject(new Error(`no such price ${id}`));
      return Promise.resolve(found);
    },
    refusalSink: (line) => refusals.push(line),
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
    pricesRetrieved,
    refusals,
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

Deno.test(
  'missing price env → 500 "price not configured", logged, Stripe + db never touched',
  async () => {
    const noMonthly = ctx({}, { priceIds: { annual: PRICES.annual } });
    const m = await run(noMonthly, 'monthly');
    assertEquals(m.res.status, 500);
    assertEquals(m.body, { error: 'price not configured' });
    assertEquals(noMonthly.db.calls.length, 0);
    assertEquals(noMonthly.pricesRetrieved, []);
    // The unset arm used to be the one refusal nothing logged (#674 item 8).
    assertEquals(noMonthly.refusals.length, 1);
    assert(noMonthly.refusals[0].includes('unset'));
    assert(noMonthly.refusals[0].includes('monthly'));

    const noAnnual = ctx({}, { priceIds: { monthly: PRICES.monthly } });
    const a = await run(noAnnual, 'annual');
    assertEquals(a.res.status, 500);
    assertEquals(a.body, { error: 'price not configured' });
  },
);

// ── the Price gate, shared with get-circle-prices (#674 item 7) ──────────────

Deno.test('the plan’s Price is read before anything else, and only that one', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] });
  await run(c, 'annual');
  assertEquals(c.pricesRetrieved, [PRICES.annual]);
});

Deno.test(
  'a Price the quote path would refuse is refused here too — before any Customer or session',
  async () => {
    // Checkout used to charge whatever the env id resolved to, so a misconfigured Price made new
    // builds refuse to quote while Checkout would still charge it. Same five gates, same answer.
    const refused: Array<[Partial<Stripe.Price>, string]> = [
      [{ active: false }, 'inactive'],
      [{ recurring: null }, 'one_off'],
      [{ recurring: yearly }, 'wrong_interval'],
      [
        { recurring: { interval: 'month', interval_count: 3 } as Stripe.Price['recurring'] },
        'multi_period',
      ],
      [{ unit_amount: null }, 'no_unit_amount'],
    ];
    for (const [over, reason] of refused) {
      const c = ctx(
        { 'circle_memberships.select': [{ data: null }] },
        { prices: { ...LIVE_PRICES, [PRICES.monthly]: price(over) } },
      );
      const { res, body } = await run(c, 'monthly');
      assertEquals(res.status, 500, reason);
      assertEquals(body, { error: 'price not configured' }, reason);
      // Refused before the membership read, the Customer, and the session.
      assertEquals(c.db.calls.length, 0, reason);
      assertEquals(c.customersCreated.length, 0, reason);
      assertEquals(c.sessionsCreated.length, 0, reason);
      // …and the operator can read which gate, for which plan, on which Price.
      assertEquals(c.refusals.length, 1, reason);
      for (const needle of ['create-circle-checkout', 'monthly', reason, PRICES.monthly]) {
        assert(c.refusals[0].includes(needle), `${reason}: line should name ${needle}`);
      }
    }
  },
);

Deno.test('the annual id pointed at a monthly Price is refused as the wrong interval', async () => {
  const c = ctx(
    { 'circle_memberships.select': [{ data: null }] },
    { prices: { ...LIVE_PRICES, [PRICES.annual]: price({ id: PRICES.annual }) } },
  );
  const { res } = await run(c, 'annual');
  assertEquals(res.status, 500);
  assert(c.refusals[0].includes('wrong_interval'));
  assertEquals(c.sessionsCreated.length, 0);
});

Deno.test(
  'prices.retrieve throwing → clean 500, nothing built, nothing refused-logged',
  async () => {
    // A Stripe outage on the read blocks the checkout on purpose: what cannot be verified is
    // not charged. It is logged as a Stripe failure (logStripeFailure), not as a gate refusal.
    const c = ctx(
      { 'circle_memberships.select': [{ data: null }] },
      { prices: { ...LIVE_PRICES, [PRICES.monthly]: new Error('stripe down') } },
    );
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'could not start checkout' });
    assertEquals(c.db.calls.length, 0);
    assertEquals(c.sessionsCreated.length, 0);
    assertEquals(c.refusals, []);
  },
);

Deno.test('a live Price passes the gate and nothing about the session params changes', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_1' } }] });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.refusals, []);
  assertEquals(c.sessionsCreated[0].line_items, [{ price: PRICES.monthly, quantity: 1 }]);
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
