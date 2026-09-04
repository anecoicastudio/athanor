// deno test supabase/functions/get-circle-prices/ — runs in CI (edge job) and locally.
// Characterization tests for the live-amount read (#644): what reaches the app is what
// Stripe charges, or nothing at all — never a number this repo made up.
// Stripe arrives as a capability closure (DI over mocks), like every sibling logic module.
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { _resetCirclePricesCacheForTest, getCirclePrices, type CirclePricesCtx } from './logic.ts';

const MONTHLY = 'price_monthly';
const ANNUAL = 'price_annual';

/** A Stripe Price as the two Circle ids actually resolve today (sandbox, 2026-09-03). */
const price = (over: Partial<Stripe.Price> = {}): Stripe.Price =>
  ({
    id: MONTHLY,
    object: 'price',
    active: true,
    currency: 'eur',
    unit_amount: 1200,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    ...over,
  }) as unknown as Stripe.Price;

type Ctx = CirclePricesCtx & { asked: string[]; refusals: string[] };

const ctx = (
  byId: Record<string, Stripe.Price | Error> = {
    [MONTHLY]: price(),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 9900,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  },
  priceIds: { monthly?: string; annual?: string } = { monthly: MONTHLY, annual: ANNUAL },
): Ctx => {
  const asked: string[] = [];
  const refusals: string[] = [];
  return {
    retrievePrice: (id: string) => {
      asked.push(id);
      const found = byId[id];
      if (found instanceof Error) return Promise.reject(found);
      return Promise.resolve(found);
    },
    priceIds,
    refusalSink: (line) => refusals.push(line),
    asked,
    refusals,
  };
};

// The memo is module state (per isolate in production); every case starts cold, and the
// memo cases below call `getCirclePrices` directly to observe a warm one.
const run = async (c: Ctx) => {
  _resetCirclePricesCacheForTest();
  const res = await getCirclePrices(c);
  return { res, body: await res.json() };
};

Deno.test('happy path → both plans, in minor units and Stripe’s own currency', async () => {
  const c = ctx();
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, {
    monthly: { unitAmount: 1200, currency: 'eur' },
    annual: { unitAmount: 9900, currency: 'eur' },
  });
  assertEquals(c.asked, [MONTHLY, ANNUAL]);
});

Deno.test('an unset price id → 500, logged per plan, and Stripe is never called', async () => {
  for (const [priceIds, missing] of [
    [{ annual: ANNUAL }, ['monthly']],
    [{ monthly: MONTHLY }, ['annual']],
    [{}, ['monthly', 'annual']],
  ] as const) {
    const c = ctx(undefined, priceIds);
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'price not configured' });
    assertEquals(c.asked, []);
    // The sixth arm (#674 item 8): a variable never set used to be the one refusal no line
    // reported. One line per missing plan, each naming it.
    assertEquals(c.refusals.length, missing.length);
    for (const plan of missing) {
      assert(
        c.refusals.some((l) => l.includes('unset') && l.includes(plan)),
        plan,
      );
    }
  }
});

Deno.test(
  'a one-off price where a subscription is charged → 500, never a rendered amount',
  async () => {
    // recurring: null is a one-time Price. Serving its amount would put a per-year number
    // where a per-month one belongs, and the savings line would be arithmetic on nonsense.
    const c = ctx({
      [MONTHLY]: price({ recurring: null }),
      [ANNUAL]: price({ id: ANNUAL, unit_amount: 9900 }),
    });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'price not configured' });
  },
);

Deno.test('a price billing on the wrong interval → 500', async () => {
  // The monthly id pointed at a yearly Price (or the reverse) is the misconfiguration that
  // makes «€99/mese» a true string about the wrong plan.
  const c = ctx({
    [MONTHLY]: price({
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 9900,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'price not configured' });
});

Deno.test('a multi-period price (every 3 months) → 500', async () => {
  const c = ctx({
    [MONTHLY]: price({
      recurring: { interval: 'month', interval_count: 3 } as Stripe.Price['recurring'],
    }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 9900,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'price not configured' });
});

Deno.test('a tiered price carries no unit_amount → 500', async () => {
  const c = ctx({
    [MONTHLY]: price({ unit_amount: null }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 9900,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'price not configured' });
});

Deno.test('an archived price → 500, never quoted then refused at Checkout', async () => {
  // An inactive Price still retrieves, so its amount would render on the CTA — and then
  // `create-circle-checkout` cannot build a session from it. That is «quotes one number,
  // charges another» in a new shape, which is the shape #644 exists to close.
  const c = ctx({
    [MONTHLY]: price({ active: false }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 9900,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'price not configured' });
  // The response stays generic; the logs say which plan, which gate, which Price (#674 item 8).
  assertEquals(c.refusals.length, 1);
  for (const needle of ['get-circle-prices', 'monthly', 'inactive', MONTHLY]) {
    assert(c.refusals[0].includes(needle), `line should name ${needle}: ${c.refusals[0]}`);
  }
});

Deno.test('both plans misconfigured → one refusal line each, still one 500', async () => {
  const c = ctx({
    [MONTHLY]: price({ recurring: null }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: null,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(c.refusals.length, 2);
  assert(c.refusals.some((l) => l.includes('monthly') && l.includes('one_off')));
  assert(c.refusals.some((l) => l.includes('annual') && l.includes('no_unit_amount')));
});

Deno.test('a free plan is served, because zero is a price', async () => {
  const c = ctx({
    [MONTHLY]: price({ unit_amount: 0 }),
    [ANNUAL]: price({
      id: ANNUAL,
      unit_amount: 0,
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
    }),
  });
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, {
    monthly: { unitAmount: 0, currency: 'eur' },
    annual: { unitAmount: 0, currency: 'eur' },
  });
});

Deno.test('a Stripe throw → clean 500, never Stripe internals', async () => {
  const c = ctx({ [MONTHLY]: new Error('stripe down'), [ANNUAL]: price({ id: ANNUAL }) });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not load prices' });
});

// ── the 60s per-isolate memo (#674 item 5) ────────────────────────────────────

Deno.test(
  'a successful read is served from memo for 60s — two Stripe reads per minute, not per open',
  async () => {
    _resetCirclePricesCacheForTest();
    let t = 1_000_000;
    const c = { ...ctx(), now: () => t };
    const first = await getCirclePrices(c);
    assertEquals(first.status, 200);
    assertEquals(c.asked.length, 2);

    t += 59_999;
    const warm = await getCirclePrices(c);
    assertEquals(warm.status, 200);
    assertEquals(await warm.json(), await first.json());
    assertEquals(c.asked.length, 2, 'a warm read must not touch Stripe');

    t += 1;
    const cold = await getCirclePrices(c);
    assertEquals(cold.status, 200);
    assertEquals(c.asked.length, 4, 'the memo expires at exactly the TTL');
  },
);

Deno.test('a failed read is never memoized — the next request asks Stripe again', async () => {
  // A refusal that stuck for a minute after the operator fixed the Price would be the
  // staleness the old «nothing is cached» docblock feared; only a success is remembered.
  _resetCirclePricesCacheForTest();
  const t = 5_000_000;
  const refused = {
    ...ctx({
      [MONTHLY]: price({ active: false }),
      [ANNUAL]: price({
        id: ANNUAL,
        recurring: { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'],
      }),
    }),
    now: () => t,
  };
  assertEquals((await getCirclePrices(refused)).status, 500);
  assertEquals((await getCirclePrices(refused)).status, 500);
  assertEquals(refused.asked.length, 4, 'a refusal is re-read every time');

  const thrown = {
    ...ctx({ [MONTHLY]: new Error('stripe down'), [ANNUAL]: price({ id: ANNUAL }) }),
    now: () => t,
  };
  assertEquals((await getCirclePrices(thrown)).status, 500);
  assertEquals((await getCirclePrices(thrown)).status, 500);
  assertEquals(thrown.asked.length, 4, 'a throw is re-read every time');
});

Deno.test('the memo does not outlive the unset-id gate', async () => {
  // Warm memo, then the ids vanish (a secret unset mid-isolate): the gate still answers first.
  _resetCirclePricesCacheForTest();
  const t = 9_000_000;
  const warm = { ...ctx(), now: () => t };
  assertEquals((await getCirclePrices(warm)).status, 200);
  const unset = { ...ctx(undefined, {}), now: () => t };
  assertEquals((await getCirclePrices(unset)).status, 500);
  assertEquals(unset.asked, []);
});
