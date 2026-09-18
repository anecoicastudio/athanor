// deno test supabase/functions/create-circle-checkout/ — runs in CI (edge job) and locally.
// Characterization tests for the circle subscription checkout: plan/price gates,
// customer reuse vs create, the dual-metadata session params, and #759's one-subscription
// ladder (guard, sweep, keys, settle).
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
  IDEMPOTENCY_WINDOW_MS,
  isCirclePlan,
  type CircleCheckoutCtx,
} from './logic.ts';

// A uuid, as getUser() returns one — the #759 tag search refuses anything else.
const PROFILE = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const EMAIL = 'seeker@example.com';
const PRICES = { monthly: 'price_month_1', annual: 'price_year_1' };

/** The clock every test runs at, and the idempotency window it falls in. */
const NOW = new Date('2026-09-18T12:03:00Z');
const WINDOW = Math.floor(NOW.getTime() / IDEMPOTENCY_WINDOW_MS);
/** `created` of the anchor (the newest Session before the request), and of the one it mints. */
const ANCHOR_AT = 1_000;
const MINTED_AT = 2_000;

type Ctx = CircleCheckoutCtx & {
  db: FakeDb;
  customersCreated: Stripe.CustomerCreateParams[];
  sessionsCreated: Stripe.Checkout.SessionCreateParams[];
  pricesRetrieved: string[];
  refusals: string[];
  /** idempotency keys, in call order */
  customerKeys: string[];
  sessionKeys: string[];
  /** what each Stripe listing was asked about */
  emailsListed: string[];
  tagQueries: string[];
  subscriptionsListedFor: string[];
  latestListedFor: string[];
  openListedFor: string[];
  expired: string[];
  /** every Stripe capability, in the order it ran — the #759 ladder's ordering is the point */
  trail: string[];
  /** logStripeFailure's operation labels */
  stripeFailures: string[];
  /** the open Sessions Stripe holds per Customer, as the request left them */
  openState: Map<string, ListedSession[]>;
};

/** A Checkout Session as the listings return it — only the fields the ladder reads. */
type ListedSession = { id: string; mode: Stripe.Checkout.Session.Mode; created: number };
const sub = (id: string, created = 500): ListedSession => ({ id, mode: 'subscription', created });

/** A Customer as `customers.list` / `customers.search` return it — only what the ladder reads. */
const stripeCustomer = (id: string, profileId?: string, created = 100): Stripe.Customer =>
  ({
    id,
    created,
    metadata: profileId ? { profile_id: profileId } : {},
  }) as unknown as Stripe.Customer;

/**
 * A small Stripe: open Sessions per Customer, which an expiry removes and a mint adds to. Enough
 * to run #759's sweep and settle against what Stripe would actually list.
 */
const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: {
    priceIds?: CircleCheckoutCtx['priceIds'];
    prices?: Record<string, Stripe.Price | Error>;
    sessionUrl?: string | null;
    throwOnCustomer?: boolean;
    /** Stripe's Customers for the caller's email, and for the tag search (#759) */
    customersByEmail?: Stripe.Customer[] | Error;
    customersByTag?: Stripe.Customer[] | Error;
    /** non-canceled subscriptions by status: for every Customer, or per Customer id */
    subscriptions?: string[] | Error;
    subscriptionsBy?: Record<string, string[]>;
    /** the newest Checkout Session (any status) — the session key's anchor */
    latest?: string | null | Error;
    /** open Sessions per Customer id; `open` is shorthand for the member's `cus_member` */
    open?: ListedSession[] | Error;
    openBy?: Record<string, ListedSession[]>;
    expireFails?: boolean;
    /** the id sessions.create answers with, and whether it is a replay (Stripe adds nothing) */
    sessionId?: string;
    replay?: boolean;
    sessionFails?: boolean;
    /** Sessions a racing request mints between this one's create and its settle */
    racers?: ListedSession[];
    /** the settle listing (after the mint) fails */
    settleFails?: boolean;
    now?: Date;
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
  const emailsListed: string[] = [];
  const tagQueries: string[] = [];
  const subscriptionsListedFor: string[] = [];
  const latestListedFor: string[] = [];
  const openListedFor: string[] = [];
  const expired: string[] = [];
  const trail: string[] = [];
  const stripeFailures: string[] = [];
  const prices = opts.prices ?? LIVE_PRICES;
  const settle = <T>(v: T | Error): Promise<T> =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  const openState = new Map<string, ListedSession[]>(
    Object.entries({
      ...(Array.isArray(opts.open) ? { cus_member: opts.open } : {}),
      ...(opts.openBy ?? {}),
    }).map(([k, v]) => [k, [...v]]),
  );
  let minted = false;
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
    now: () => opts.now ?? NOW,
    listCustomersByEmail: (email) => {
      trail.push('listCustomersByEmail');
      emailsListed.push(email);
      return settle(opts.customersByEmail ?? []);
    },
    searchCustomersByTag: (query) => {
      trail.push('searchCustomersByTag');
      tagQueries.push(query);
      return settle(opts.customersByTag ?? []);
    },
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
      const subs = opts.subscriptionsBy?.[customerId] ?? opts.subscriptions ?? [];
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
          : ({ id: latest, mode: 'subscription', created: ANCHOR_AT } as Stripe.Checkout.Session),
      );
    },
    listOpenCheckoutSessions: (customerId) => {
      trail.push('listOpenCheckoutSessions');
      openListedFor.push(customerId);
      if (opts.open instanceof Error) return Promise.reject(opts.open);
      if (minted && opts.settleFails) return Promise.reject(new Error('stripe down'));
      return Promise.resolve([
        ...(openState.get(customerId) ?? []),
      ] as unknown as Stripe.Checkout.Session[]);
    },
    expireCheckoutSession: (id) => {
      trail.push('expireCheckoutSession');
      expired.push(id);
      if (opts.expireFails) return Promise.reject(new Error('session is not open'));
      for (const [k, list] of openState) {
        if (list.some((s) => s.id === id)) {
          openState.set(
            k,
            list.filter((s) => s.id !== id),
          );
          return Promise.resolve({ id, status: 'expired' } as Stripe.Checkout.Session);
        }
      }
      // Stripe refuses to expire a Session that is not open.
      return Promise.reject(new Error(`session ${id} is not open`));
    },
    createCheckoutSession: (params, { idempotencyKey }) => {
      trail.push('createCheckoutSession');
      sessionsCreated.push(params);
      sessionKeys.push(idempotencyKey);
      if (opts.sessionFails) return Promise.reject(new Error('idempotency_error'));
      minted = true;
      const id = opts.sessionId ?? 'cs_fresh';
      const customer = params.customer as string;
      const list = openState.get(customer) ?? [];
      if (!opts.replay) list.push({ id, mode: 'subscription', created: MINTED_AT });
      list.push(...(opts.racers ?? []));
      openState.set(customer, list);
      return Promise.resolve({
        id,
        created: MINTED_AT,
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
    emailsListed,
    tagQueries,
    subscriptionsListedFor,
    latestListedFor,
    openListedFor,
    expired,
    trail,
    stripeFailures,
    openState,
  };
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
  // #759 — no Customer on Stripe tagged with this member, by email or by tag, so one is made,
  // keyed on the member and the window: two first attempts racing each other get ONE Customer.
  assertEquals(c.emailsListed, [EMAIL]);
  assertEquals(c.tagQueries, [`metadata['profile_id']:'${PROFILE}'`]);
  assertEquals(c.customerKeys, [`circle-customer:${PROFILE}:${WINDOW}`]);
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
const FAILED = { error: 'could not start checkout' };
// A factory: the fake db consumes its script FIFO, so a shared literal would be empty after one use.
const member = (): Record<string, FakeResult[]> => ({
  'circle_memberships.select': [{ data: { stripe_customer_id: 'cus_member' } }],
});
const noRow = (): Record<string, FakeResult[]> => ({
  'circle_memberships.select': [{ data: null }],
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

// ── #759: which Customers the member holds ───────────────────────────────────────

Deno.test(
  '#759 paid, webhook not landed, tapped again → the tagged Customer is found and refused',
  async () => {
    // No row yet — the webhook writes it — but the first attempt's Customer exists on Stripe,
    // tagged with this member, and already carries the subscription they just paid for.
    const c = ctx(noRow(), {
      customersByEmail: [
        stripeCustomer('cus_else', 'prof-9'),
        stripeCustomer('cus_tagged', PROFILE),
      ],
      subscriptions: ['active'],
    });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 409);
    assertEquals(body, REFUSED);
    assertEquals(c.emailsListed, [EMAIL]);
    assertEquals(c.customersCreated, []);
    assertEquals(c.subscriptionsListedFor, ['cus_tagged']);
    assertEquals(c.sessionsCreated, []);
  },
);

Deno.test(
  '#759 a row-less member reuses their tagged Customer, and its Session is swept',
  async () => {
    // Opened Checkout, backed out, came back: one Customer, and the first attempt's Session is
    // expired on it — a second Customer would leave that Session payable where no sweep looks.
    const c = ctx(noRow(), {
      customersByEmail: [stripeCustomer('cus_tagged', PROFILE)],
      latest: 'cs_first',
      openBy: { cus_tagged: [sub('cs_first', ANCHOR_AT)] },
    });
    const { res } = await run(c, 'annual');
    assertEquals(res.status, 200);
    assertEquals(c.customersCreated, []);
    assertEquals(c.expired, ['cs_first']);
    assertEquals(c.sessionsCreated[0].customer, 'cus_tagged');
  },
);

Deno.test('#759 an email match without the tag is someone else’s Customer', async () => {
  const c = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_untagged'), stripeCustomer('cus_old', 'prof-0')],
  });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.customersCreated.length, 1);
  assertEquals(c.sessionsCreated[0].customer, 'cus_new');
});

Deno.test(
  '#759 a row names the Customer — Stripe’s Customers are not listed or searched',
  async () => {
    const c = ctx(member());
    await run(c, 'monthly');
    assertEquals(c.emailsListed, []);
    assertEquals(c.tagQueries, []);
    assertEquals(c.sessionsCreated[0].customer, 'cus_member');
  },
);

Deno.test('#759 no email → nothing to list by, but the tag is still searched', async () => {
  const c = ctx(noRow());
  const res = await createCircleCheckout(c, { profileId: PROFILE, plan: 'monthly' });
  assertEquals(res.status, 200);
  assertEquals(c.emailsListed, []);
  assertEquals(c.tagQueries, [`metadata['profile_id']:'${PROFILE}'`]);
  assertEquals(c.customersCreated, [{ email: undefined, metadata: { profile_id: PROFILE } }]);
});

Deno.test(
  '#759 an email changed since the first attempt: the tag search still finds it',
  async () => {
    // The email listing is exact, so a Customer made under the old address is not in it. The tag
    // search finds it, and its live subscription refuses — a second Customer would have billed
    // alongside it.
    const c = ctx(noRow(), {
      customersByEmail: [],
      customersByTag: [stripeCustomer('cus_old_email', PROFILE)],
      subscriptionsBy: { cus_old_email: ['active'] },
    });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 409);
    assertEquals(body, REFUSED);
    assertEquals(c.customersCreated, []);
  },
);

Deno.test('#759 several tagged Customers: every one is swept and guarded', async () => {
  // A member can hold more than one — made under an earlier email, or by the function before
  // #759, which minted a Customer on every row-less attempt. The newest is minted on; the older
  // ones' open Sessions are all expired and their subscriptions all checked.
  const c = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_newer', PROFILE, 300)],
    customersByTag: [stripeCustomer('cus_older', PROFILE, 100)],
    latest: 'cs_n',
    openBy: {
      cus_newer: [sub('cs_n', ANCHOR_AT)],
      cus_older: [sub('cs_o1', 50), sub('cs_o2', 5_000)],
    },
  });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.expired, ['cs_n', 'cs_o1', 'cs_o2']);
  assertEquals(c.subscriptionsListedFor, ['cus_newer', 'cus_older']);
  assertEquals(c.sessionsCreated[0].customer, 'cus_newer');

  const live = ctx(noRow(), {
    customersByEmail: [stripeCustomer('cus_newer', PROFILE, 300)],
    customersByTag: [stripeCustomer('cus_older', PROFILE, 100)],
    subscriptionsBy: { cus_older: ['past_due'] },
  });
  const refused = await run(live, 'monthly');
  assertEquals(refused.res.status, 409);
  assertEquals(live.sessionsCreated, []);
});

// ── #759: fail closed ────────────────────────────────────────────────────────────

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
  '#759 any Stripe listing failing → 500, no Session (never sell when unsure)',
  async () => {
    const cases: Array<[Record<string, FakeResult[]>, Parameters<typeof ctx>[1]]> = [
      [member(), { subscriptions: new Error('down') }],
      [member(), { latest: new Error('down') }],
      [member(), { open: new Error('down') }],
      [noRow(), { customersByEmail: new Error('down') }],
      [noRow(), { customersByTag: new Error('down') }],
    ];
    for (const [script, opts] of cases) {
      const c = ctx(script, opts);
      const { res, body } = await run(c, 'monthly');
      assertEquals(res.status, 500, JSON.stringify(opts));
      assertEquals(body, FAILED);
      assertEquals(c.sessionsCreated, []);
    }
  },
);

// ── #759: one payable Checkout Session per Customer ──────────────────────────────

Deno.test(
  '#759 open Circle Sessions up to the anchor are expired before one is minted',
  async () => {
    // A Session left open on another device (or behind a closed browser) stays payable for up to
    // 24h. Two payable Sessions are two subscriptions if both are paid, so the older ones go first.
    // A payment-mode Session is never touched: the sweep only retires what this function mints.
    const c = ctx(member(), {
      latest: 'cs_old_2',
      open: [
        sub('cs_old_1', 900),
        { ...sub('cs_pay', 950), mode: 'payment' },
        sub('cs_old_2', ANCHOR_AT),
      ],
    });
    const { res } = await run(c, 'monthly');
    assertEquals(res.status, 200);
    assertEquals(c.expired, ['cs_old_1', 'cs_old_2']);
    assertEquals(c.sessionsCreated.length, 1);
    assertEquals(
      c.openState.get('cus_member')?.map((s) => s.id),
      ['cs_pay', 'cs_fresh'],
    );
  },
);

Deno.test('#759 the sweep runs BEFORE the live-subscription check', async () => {
  // The order is the guarantee. An open Session paid between a listing that found no live
  // subscription and its own expiry would be a live subscription the check never saw. Expired
  // first, it can no longer complete; completed first, the expiry fails (next test) or the
  // listing that follows sees its subscription.
  const c = ctx(member(), { latest: 'cs_old', open: [sub('cs_old', ANCHOR_AT)] });
  await run(c, 'monthly');
  assertEquals(c.trail, [
    'latestCheckoutSession',
    'listOpenCheckoutSessions',
    'expireCheckoutSession',
    'listSubscriptions',
    'createCheckoutSession',
    'listOpenCheckoutSessions',
  ]);
});

Deno.test('#759 an expiry that fails → 500, no Session (it may have just been paid)', async () => {
  // Stripe refuses to expire a Session that is no longer open — the likeliest cause here is that
  // it completed a moment ago. Minting another then would be the double charge.
  const c = ctx(member(), {
    latest: 'cs_old',
    open: [sub('cs_old', ANCHOR_AT)],
    expireFails: true,
  });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, FAILED);
  assertEquals(c.sessionsCreated, []);
  assertEquals(c.subscriptionsListedFor, [], 'nothing past the failed sweep ran');
});

Deno.test('#759 the Session key is anchored to the newest Session the Customer has', async () => {
  // Two requests racing past every check see the same newest Session, so they send the same key
  // and Stripe hands both the same Session. Once a Session exists it IS the newest, so the next
  // attempt keys differently and gets a fresh one.
  const none = ctx(member(), { latest: null });
  await run(none, 'monthly');
  assertEquals(none.sessionKeys, [`circle-checkout:cus_member:none:${WINDOW}`]);

  const after = ctx(member(), { latest: 'cs_prev' });
  await run(after, 'annual');
  assertEquals(after.sessionKeys, [`circle-checkout:cus_member:cs_prev:${WINDOW}`]);

  const again = ctx(member(), { latest: 'cs_prev' });
  await run(again, 'annual');
  assertEquals(again.sessionKeys, after.sessionKeys, 'same observed state → same key');
});

Deno.test('#759 the two plans racing share ONE key — Stripe refuses the second', async () => {
  // Monthly on one device, annual on another, both past every check before either has minted.
  // With the Price in the key they would mint two payable Sessions; without it they send one
  // key with different parameters, and Stripe refuses the later request.
  const monthly = ctx(member(), { latest: 'cs_prev' });
  await run(monthly, 'monthly');
  const annual = ctx(member(), { latest: 'cs_prev' });
  await run(annual, 'annual');
  assertEquals(monthly.sessionKeys, annual.sessionKeys);

  // …and the refusal is a clean 500, logged under the mint.
  const refusedByStripe = ctx(member(), { latest: 'cs_prev', sessionFails: true });
  const { res, body } = await run(refusedByStripe, 'annual');
  assertEquals(res.status, 500);
  assertEquals(body, FAILED);
  assertEquals(refusedByStripe.stripeFailures, [
    'create-circle-checkout: checkout.sessions.create',
  ]);
});

Deno.test(
  '#759 both keys expire with their window — a saved failure blocks for one window at most',
  async () => {
    // Stripe replays a request's saved result, a 500 included, for as long as it keeps the key —
    // 24h. An attempt whose sessions.create failed minted nothing, so the next one reads the same
    // newest Session: without a window it would send the same key and be refused the same 500 for
    // a day. The window bounds that.
    const later = new Date(NOW.getTime() + IDEMPOTENCY_WINDOW_MS);
    const a = ctx(noRow(), { latest: 'cs_prev' });
    await run(a, 'monthly');
    const b = ctx(noRow(), { latest: 'cs_prev', now: later });
    await run(b, 'monthly');
    assertEquals(b.sessionKeys, [`circle-checkout:cus_new:cs_prev:${WINDOW + 1}`]);
    assert(a.sessionKeys[0] !== b.sessionKeys[0]);
    assertEquals(b.customerKeys, [`circle-customer:${PROFILE}:${WINDOW + 1}`]);
    assert(a.customerKeys[0] !== b.customerKeys[0]);
    assertEquals(IDEMPOTENCY_WINDOW_MS, 10 * 60_000);
  },
);

// ── #759 step 5: the newest open Session survives ────────────────────────────────

Deno.test('#759 a racer’s Session newer than the anchor is shared, not swept', async () => {
  // A racing request with the same anchor minted S before this one listed open Sessions. S is
  // newer than the anchor, so the sweep leaves it; this request's mint, under the same key, is
  // answered with S; S is the newest open Session, so both requests hand out S — one payable
  // Session, both devices on it. Sweeping S would have left none.
  const c = ctx(member(), {
    latest: 'cs_prev',
    open: [sub('cs_shared', 1_500)],
    sessionId: 'cs_shared',
    replay: true,
  });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(body.kind, 'url');
  assertEquals(c.expired, []);
  assertEquals(
    c.openState.get('cus_member')?.map((s) => s.id),
    ['cs_shared'],
  );
});

Deno.test('#759 a replay of a Session that is no longer open is not handed out', async () => {
  // A replay is Stripe's saved snapshot, still reading `open` — a racer may have expired it since.
  // The live listing is what decides: no URL rather than a dead one, and a clean refusal — not a
  // crash into the catch, and not an expiry of someone else's Session.
  for (const racers of [[], [sub('cs_other', 1_500)]]) {
    const c = ctx(member(), { latest: 'cs_prev', sessionId: 'cs_gone', replay: true, racers });
    const { res, body } = await run(c, 'monthly');
    assertEquals(res.status, 500);
    assertEquals(body, FAILED);
    assertEquals(c.expired, []);
    assertEquals(c.stripeFailures, []);
  }
});

Deno.test('#759 a newer racer wins: ours is expired and no URL is handed out', async () => {
  // A racer on the far side of a window boundary minted under another key, after ours. Every
  // request orders the open Sessions the same way, so ours steps aside and the racer's stands.
  const c = ctx(member(), { latest: 'cs_prev', racers: [sub('cs_racer', 3_000)] });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, FAILED);
  assertEquals(c.expired, ['cs_fresh']);
  assertEquals(
    c.openState.get('cus_member')?.map((s) => s.id),
    ['cs_racer'],
  );
});

Deno.test('#759 an older racer loses: expired, and ours is handed out', async () => {
  // The same boundary race the other way round. Two Sessions would have stayed payable — the
  // sweep of each ran before the other minted — so the newest (ours) survives alone.
  const c = ctx(member(), { latest: 'cs_prev', racers: [sub('cs_racer', 1_500)] });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 200);
  assertEquals(c.expired, ['cs_racer']);
  assertEquals(
    c.openState.get('cus_member')?.map((s) => s.id),
    ['cs_fresh'],
  );
});

Deno.test('#759 same second: the id decides, the same way for every racer', async () => {
  const c = ctx(member(), { latest: 'cs_prev', racers: [sub('cs_zzz', MINTED_AT)] });
  const { res } = await run(c, 'monthly');
  assertEquals(res.status, 500, "'cs_zzz' sorts after 'cs_fresh', so it is the newer one");
  assertEquals(
    c.openState.get('cus_member')?.map((s) => s.id),
    ['cs_zzz'],
  );
});

Deno.test('#759 the settle listing failing → 500, no URL', async () => {
  const c = ctx(member(), { latest: 'cs_prev', settleFails: true });
  const { res, body } = await run(c, 'monthly');
  assertEquals(res.status, 500);
  assertEquals(body, FAILED);
  assertEquals(c.stripeFailures, ['create-circle-checkout: checkout.sessions.list open']);
});

Deno.test('#759 a failed Stripe call is logged under the step that failed', async () => {
  // Every Stripe call below the membership read shares one catch; «could not start checkout»
  // alone cannot tell the operator whether an expiry was refused (a Session paid a moment ago,
  // or a racing tap) or Stripe was down.
  const cases: Array<[Record<string, FakeResult[]>, Parameters<typeof ctx>[1], string]> = [
    [noRow(), { customersByEmail: new Error('down') }, 'customers.list'],
    [noRow(), { customersByTag: new Error('down') }, 'customers.search'],
    [noRow(), { throwOnCustomer: true }, 'customers.create'],
    [member(), { latest: new Error('down') }, 'checkout.sessions.list latest'],
    [member(), { open: new Error('down') }, 'checkout.sessions.list open'],
    [
      member(),
      { latest: 'cs_old', open: [sub('cs_old', ANCHOR_AT)], expireFails: true },
      'checkout.sessions.expire',
    ],
    [member(), { subscriptions: new Error('down') }, 'subscriptions.list'],
    [member(), { sessionFails: true }, 'checkout.sessions.create'],
  ];
  for (const [script, opts, step] of cases) {
    const c = ctx(script, opts);
    const { res } = await run(c, 'monthly');
    assertEquals(res.status, 500, step);
    assertEquals(c.stripeFailures, [`create-circle-checkout: ${step}`], step);
  }
});
