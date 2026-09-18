// deno test supabase/functions/create-circle-checkout/ — runs in CI (edge job) and locally.
// Characterization tests for the circle subscription checkout: plan/price gates,
// customer reuse vs create, and the dual-metadata session params.
// All db I/O through injected fakes; Stripe as capability closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  blocksNewSubscription,
  CIRCLE_CHECKOUT_FLAG,
  createCircleCheckout,
  isCirclePlan,
  type CircleCheckoutCtx,
} from './logic.ts';

const PROFILE = 'prof-1';
const EMAIL = 'seeker@example.com';
const PRICES = { monthly: 'price_month_1', annual: 'price_year_1' };

type Ctx = CircleCheckoutCtx & {
  db: FakeDb;
  customersCreated: Stripe.CustomerCreateParams[];
  sessionsCreated: Stripe.Checkout.SessionCreateParams[];
  pricesRetrieved: string[];
  refusals: string[];
  /** idempotency keys, in call order */
  customerKeys: string[];
  sessionKeys: string[];
  /** customer ids each Stripe listing was asked about */
  subscriptionsListedFor: string[];
  latestListedFor: string[];
  openListedFor: string[];
  expired: string[];
  /** every Stripe capability, in the order it ran — the #759 ladder's ordering is the point */
  trail: string[];
  /** logStripeFailure's operation labels */
  stripeFailures: string[];
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

/** A Checkout Session as the listings return it — only the fields the ladder reads. */
type ListedSession = { id: string; mode: Stripe.Checkout.Session.Mode };

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: {
    priceIds?: CircleCheckoutCtx['priceIds'];
    prices?: Record<string, Stripe.Price | Error>;
    sessionUrl?: string | null;
    /** the id sessions.create answers with — a replay can hand back one the sweep just expired */
    sessionId?: string;
    throwOnCustomer?: boolean;
    /** the Customer's non-canceled subscriptions, by status, as Stripe lists them (#759) */
    subscriptions?: string[] | Error;
    /** the Customer's newest Checkout Session, any status — the session key's anchor */
    latest?: string | null | Error;
    /** the Customer's OPEN Checkout Sessions — what the sweep expires */
    open?: ListedSession[] | Error;
    expireFails?: boolean;
  } = {},
): Ctx => {
  // Every test runs with checkout OPEN unless it scripts the flag itself (#747 block below).
  const db = makeFakeDb({
    'remote_config.select': [{ data: { value: { enabled: true } } }],
    ...script,
  });
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const sessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
  const pricesRetrieved: string[] = [];
  const refusals: string[] = [];
  const customerKeys: string[] = [];
  const sessionKeys: string[] = [];
  const subscriptionsListedFor: string[] = [];
  const latestListedFor: string[] = [];
  const openListedFor: string[] = [];
  const expired: string[] = [];
  const trail: string[] = [];
  const stripeFailures: string[] = [];
  const prices = opts.prices ?? LIVE_PRICES;
  const settle = <T>(v: T | Error): Promise<T> =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
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
    stripeFailureSink: (operation) => stripeFailures.push(operation),
    createCustomer: (params, { idempotencyKey }) => {
      trail.push('createCustomer');
      customersCreated.push(params);
      customerKeys.push(idempotencyKey);
      if (opts.throwOnCustomer) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({ id: 'cus_new' } as Stripe.Customer);
    },
    listSubscriptions: (customerId) => {
      trail.push('listSubscriptions');
      subscriptionsListedFor.push(customerId);
      const subs = opts.subscriptions ?? [];
      return settle(
        subs instanceof Error
          ? subs
          : subs.map((status, i) => ({ id: `sub_${i}`, status }) as unknown as Stripe.Subscription),
      );
    },
    latestCheckoutSession: (customerId) => {
      trail.push('latestCheckoutSession');
      latestListedFor.push(customerId);
      const latest = opts.latest ?? null;
      return settle(
        latest instanceof Error || latest === null
          ? latest
          : ({ id: latest, mode: 'subscription' } as Stripe.Checkout.Session),
      );
    },
    listOpenCheckoutSessions: (customerId) => {
      trail.push('listOpenCheckoutSessions');
      openListedFor.push(customerId);
      const open = opts.open ?? [];
      return settle(open instanceof Error ? open : (open as unknown as Stripe.Checkout.Session[]));
    },
    expireCheckoutSession: (id) => {
      trail.push('expireCheckoutSession');
      expired.push(id);
      if (opts.expireFails) return Promise.reject(new Error('session is not open'));
      return Promise.resolve({ id, status: 'expired' } as Stripe.Checkout.Session);
    },
    createCheckoutSession: (params, { idempotencyKey }) => {
      trail.push('createCheckoutSession');
      sessionsCreated.push(params);
      sessionKeys.push(idempotencyKey);
      return Promise.resolve({
        id: opts.sessionId ?? 'cs_fresh',
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
    customerKeys,
    sessionKeys,
    subscriptionsListedFor,
    latestListedFor,
    openListedFor,
    expired,
    trail,
    stripeFailures,
  };
};

/** The caller's data reads — every db call except the #747 flag read, which precedes them all. */
const dataCalls = (c: Ctx) => c.db.calls.filter((k) => k.table !== 'remote_config');

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
  assertEquals(dataCalls(c).length, 0);
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
    assertEquals(dataCalls(noMonthly).length, 0);
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
      assertEquals(dataCalls(c).length, 0, reason);
      assertEquals(c.trail, [], reason);
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
    assertEquals(dataCalls(c).length, 0);
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
  const q = dataCalls(c)[0];
  assertEquals(q.table, 'circle_memberships');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'profile_id' && v === PROFILE));
});

Deno.test('no membership → Customer created with email + profile_id tag, then used', async () => {
  const c = ctx({ 'circle_memberships.select': [{ data: null }] });
  const { res } = await run(c, 'annual');
  assertEquals(res.status, 200);

  assertEquals(c.customersCreated, [{ email: EMAIL, metadata: { profile_id: PROFILE } }]);
  // #759 — keyed on the member, so a second attempt before the first webhook lands gets the SAME
  // Customer back from Stripe instead of a second one.
  assertEquals(c.customerKeys, [`circle-customer:${PROFILE}`]);
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

// ── #747: the checkout flag, server side ─────────────────────────────────────────
// The client hides the CTA on the same flag; this is the half a bypassed or pre-#747 client
// cannot skip. Fails CLOSED on every doubt — the opposite of version-gate.ts — because what it
// guards is a Checkout against keys that may still be test-mode.

const flag = (r: FakeResult): Record<string, FakeResult[]> => ({ 'remote_config.select': [r] });

const assertClosedUntouched = (
  c: Ctx,
  res: Response,
  body: { error?: string },
  reason: 'read-error' | 'absent' | 'malformed' | 'off',
) => {
  assertEquals(res.status, 403);
  assertEquals(body.error, 'circle checkout closed');
  assertEquals(c.pricesRetrieved, [], 'no Stripe read before the flag check');
  assertEquals(c.customersCreated, [], 'no Customer minted');
  assertEquals(c.sessionsCreated, [], 'no Checkout Session minted');
  assertEquals(c.trail, [], 'no Stripe call of any kind (#759 listings included)');
  assertEquals(dataCalls(c), [], 'no membership read either');
  assertEquals(
    c.db.calls.filter((k) => k.table === 'remote_config').length,
    1,
    'exactly one flag read',
  );
  assertEquals(c.refusals, [
    `[circle] create-circle-checkout: checkout closed ${JSON.stringify({
      flag: 'circle_checkout_enabled',
      reason,
    })}`,
  ]);
};

Deno.test(
  '#747 flag on → checkout proceeds, the read names the key, nothing is logged',
  async () => {
    const c = ctx();
    const { res } = await run(c, 'monthly');
    assertEquals(res.status, 200);
    assertEquals(c.sessionsCreated.length, 1);
    const read = c.db.calls[0];
    assertEquals(read.table, 'remote_config', 'the flag is the first read');
    assertEquals(read.filters, [['eq', 'key', CIRCLE_CHECKOUT_FLAG]]);
    assertEquals(CIRCLE_CHECKOUT_FLAG, 'circle_checkout_enabled');
    assertEquals(c.refusals, []);
  },
);

Deno.test('#747 flag off → 403 circle checkout closed, nothing touched', async () => {
  const c = ctx(flag({ data: { value: { enabled: false } } }));
  const { res, body } = await run(c, 'monthly');
  assertClosedUntouched(c, res, body, 'off');
});

Deno.test('#747 flag absent → closed', async () => {
  const c = ctx(flag({ data: null }));
  const { res, body } = await run(c, 'monthly');
  assertClosedUntouched(c, res, body, 'absent');
});

Deno.test('#747 flag malformed → closed (truthy is not true)', async () => {
  for (const value of [{ enabled: 'true' }, { enabled: 1 }, {}, null, 'on', true]) {
    const c = ctx(flag({ data: { value } }));
    const { res, body } = await run(c, 'annual');
    assertClosedUntouched(c, res, body, 'malformed');
  }
});

Deno.test('#747 flag read error → closed, even when an open payload rides along', async () => {
  // The payload says open; only the error arm can close this — so a gate that ignored the
  // error would go red here instead of passing on the payload's absence.
  const c = ctx(
    flag({
      data: { value: { enabled: true } },
      error: { message: 'connection reset', code: '08006' },
    }),
  );
  const { res, body } = await run(c, 'monthly');
  assertClosedUntouched(c, res, body, 'read-error');
});

Deno.test('#747 the flag is checked before the plan is even validated', async () => {
  const c = ctx(flag({ data: null }));
  const { res, body } = await run(c, 'weekly');
  assertClosedUntouched(c, res, body, 'absent');
});

// ── #759: one live subscription per member ───────────────────────────────────────
// The function used to mint a subscription-mode Session for anyone who asked, so a member who
// already paid could be billed twice: reproduced on staging 2026-09-18 — an active member's
// direct call came back 200 with an open Session on the Customer that already held the live
// subscription. Stripe decides whether one is live (rule #6): the cached row lags a webhook, and
// it folds `unpaid`/`paused` into `canceled`, so it cannot tell a dunning subscription from a
// dead one.

const REFUSED = { error: 'circle already subscribed' };
// A factory: the fake db consumes its script FIFO, so a shared literal would be empty after one use.
const member = (): Record<string, FakeResult[]> => ({
  'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_member' } }],
});

Deno.test('#759 blocksNewSubscription: every status but the two terminal ones blocks', () => {
  // The six a second subscription would bill ALONGSIDE: Stripe's own «limit customers to one
  // subscription» set (active, past_due, unpaid, paused), plus trialing, plus incomplete —
  // a first payment still settling, which lands as a second charge if a new one is started.
  for (const s of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    assertEquals(blocksNewSubscription(s), true, s);
  }
  // The two that can never bill again.
  for (const s of ['canceled', 'incomplete_expired']) {
    assertEquals(blocksNewSubscription(s), false, s);
  }
  // A status this code has never heard of blocks: fail closed, on the money path.
  assertEquals(blocksNewSubscription('some_future_status'), true);
});

Deno.test('#759 a live subscription → 409, no Session minted', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    const c = ctx(member(), { subscriptions: [status] });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 409, status);
    assertEquals(body, REFUSED, status);
    assertEquals(c.sessionsCreated, [], status);
    // Asked about the member's own Customer — the one the row names.
    assertEquals(c.subscriptionsListedFor, ['cus_member'], status);
    assertEquals(c.customersCreated, [], status);
  }
});

Deno.test('#759 one live subscription among dead ones still refuses', async () => {
  const c = ctx(member(), { subscriptions: ['canceled', 'incomplete_expired', 'past_due'] });
  const { res, body } = await run(c, 'annual');
  assertEquals(res.status, 409);
  assertEquals(body, REFUSED);
  assertEquals(c.sessionsCreated, []);
});

Deno.test('#759 only terminal subscriptions → a returning member may subscribe again', async () => {
  const c = ctx(member(), { subscriptions: ['canceled', 'incomplete_expired'] });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.sessionsCreated.length, 1);
  assertEquals(c.sessionsCreated[0].customer, 'cus_member');
});

Deno.test('#759 Stripe decides, not the cached row', async () => {
  // The read never asks the row's status: a row reading `active` over a subscription Stripe
  // canceled (a cancellation webhook that never landed) must not lock the member out, and a row
  // reading `canceled` over an `unpaid` one must not let a second one through. Only
  // `stripe_customer_id` is selected.
  const c = ctx(member(), { subscriptions: [] });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  const read = dataCalls(c)[0];
  assertEquals(read.table, 'circle_memberships');
  assertEquals(read.columns, 'stripe_customer_id');
});

Deno.test(
  '#759 a first-time member is checked too — on the Customer Stripe hands back',
  async () => {
    // No row yet, so the Customer is created (keyed on the member). A second attempt before the
    // first webhook lands gets that SAME Customer replayed by Stripe — which may already carry the
    // subscription the first attempt paid for. So the listing runs on this path as well.
    const c = ctx({ 'circle_memberships.select': [{ data: null }] }, { subscriptions: ['active'] });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 409);
    assertEquals(body, REFUSED);
    assertEquals(c.customerKeys, [`circle-customer:${PROFILE}`]);
    assertEquals(c.subscriptionsListedFor, ['cus_new']);
    assertEquals(c.sessionsCreated, []);
  },
);

Deno.test('#759 membership read error → 500, fails closed before any Stripe call', async () => {
  // A failed read used to read as «no membership»: a fresh Customer and a fresh subscription for
  // someone who may already hold one. The payload that rides along must not be trusted either.
  const c = ctx({
    'circle_memberships.select': [
      { data: { stripe_customer_id: 'cus_member' }, error: { message: 'boom', code: '08006' } },
    ],
  });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'membership lookup failed' });
  assertEquals(c.trail, []);
});

Deno.test(
  '#759 the subscription listing failing → 500, no Session (never sell when unsure)',
  async () => {
    const c = ctx(member(), { subscriptions: new Error('stripe down') });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'could not start checkout' });
    assertEquals(c.sessionsCreated, []);
  },
);

// ── #759: one payable Checkout Session per Customer ──────────────────────────────

Deno.test('#759 open Circle Sessions are expired before a new one is minted', async () => {
  // A Session left open on another device (or behind a closed browser) stays payable for up to
  // 24h. Two payable Sessions are two subscriptions if both are paid, so the older ones go first.
  // A payment-mode Session is never touched: this Customer is Circle's, but the sweep only
  // retires what it owns.
  const c = ctx(member(), {
    latest: 'cs_old_2',
    open: [
      { id: 'cs_old_1', mode: 'subscription' },
      { id: 'cs_pay', mode: 'payment' },
      { id: 'cs_old_2', mode: 'subscription' },
    ],
  });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.openListedFor, ['cus_member']);
  assertEquals(c.expired, ['cs_old_1', 'cs_old_2']);
  assertEquals(c.sessionsCreated.length, 1);
});

Deno.test('#759 the sweep runs BEFORE the live-subscription check', async () => {
  // The order is the guarantee. An open Session paid between a listing that found no live
  // subscription and its own expiry would be a live subscription the check never saw. Expired
  // first, it can no longer complete; completed first, the expiry fails (next test) or the
  // listing that follows sees its subscription.
  const c = ctx(member(), { latest: 'cs_old', open: [{ id: 'cs_old', mode: 'subscription' }] });
  await run(c, 'monthly');
  assertEquals(c.trail, [
    'latestCheckoutSession',
    'listOpenCheckoutSessions',
    'expireCheckoutSession',
    'listSubscriptions',
    'createCheckoutSession',
  ]);
});

Deno.test('#759 an expiry that fails → 500, no Session (it may have just been paid)', async () => {
  // Stripe refuses to expire a Session that is no longer open — the likeliest cause here is that
  // it completed a moment ago. Minting another then would be the double charge.
  const c = ctx(member(), { open: [{ id: 'cs_old', mode: 'subscription' }], expireFails: true });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not start checkout' });
  assertEquals(c.sessionsCreated, []);
  assertEquals(c.subscriptionsListedFor, [], 'nothing past the failed sweep ran');
});

Deno.test('#759 the listings failing → 500, no Session', async () => {
  for (const opts of [{ latest: new Error('down') }, { open: new Error('down') }]) {
    const c = ctx(member(), opts);
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'could not start checkout' });
    assertEquals(c.sessionsCreated, []);
  }
});

Deno.test('#759 the Session key is anchored to the newest Session the Customer has', async () => {
  // Two requests racing past every check see the same newest Session, so they send the same key
  // and Stripe hands both the same Session: one payable Session, however many taps. Once a
  // Session exists it IS the newest, so the next attempt keys differently and gets a fresh one.
  const none = ctx(member(), { latest: null });
  await run(none, 'monthly');
  assertEquals(none.sessionKeys, [`circle-checkout:cus_member:${PRICES.monthly}:none`]);

  const after = ctx(member(), { latest: 'cs_prev' });
  await run(after, 'annual');
  // The Price id, not the plan name: same key must mean same params, or Stripe errors.
  assertEquals(after.sessionKeys, [`circle-checkout:cus_member:${PRICES.annual}:cs_prev`]);

  const again = ctx(member(), { latest: 'cs_prev' });
  await run(again, 'annual');
  assertEquals(again.sessionKeys, after.sessionKeys, 'same observed state → same key');
});

Deno.test('#759 a replay of a Session the sweep just expired is not handed out', async () => {
  // The race the key cannot close alone: a concurrent request minted S under this key, and this
  // request's sweep then expired S. Stripe replays S for the key — a dead URL. Say so instead.
  const c = ctx(member(), {
    latest: 'cs_prev',
    open: [{ id: 'cs_raced', mode: 'subscription' }],
    sessionId: 'cs_raced',
  });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not start checkout' });
});

Deno.test('#759 a failed Stripe call is logged under the step that failed', async () => {
  // Six calls share one catch; «could not start checkout» alone cannot tell the operator whether
  // an expiry was refused (a Session paid a moment ago, or a concurrent tap) or Stripe was down.
  const cases: Array<[Parameters<typeof ctx>[1], string]> = [
    [{ throwOnCustomer: true }, 'customers.create'],
    [{ latest: new Error('down') }, 'checkout.sessions.list latest'],
    [{ open: new Error('down') }, 'checkout.sessions.list open'],
    [
      { open: [{ id: 'cs_old', mode: 'subscription' }], expireFails: true },
      'checkout.sessions.expire',
    ],
    [{ subscriptions: new Error('down') }, 'subscriptions.list'],
  ];
  for (const [opts, step] of cases) {
    const script = opts?.throwOnCustomer
      ? { 'circle_memberships.select': [{ data: null }] }
      : member();
    const c = ctx(script, opts);
    const { res } = await run(c, 'monthly');
    assertEquals(res.status, 500, step);
    assertEquals(c.stripeFailures, [`create-circle-checkout: ${step}`], step);
  }
});
