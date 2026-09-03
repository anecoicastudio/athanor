// deno test supabase/functions/get-circle-prices/ — runs in CI (edge job) and locally.
// Characterization tests for the live-amount read (#644): what reaches the app is what
// Stripe charges, or nothing at all — never a number this repo made up.
// Stripe arrives as a capability closure (DI over mocks), like every sibling logic module.
import { assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { getCirclePrices, type CirclePricesCtx } from './logic.ts';

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

type Ctx = CirclePricesCtx & { asked: string[] };

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
  return {
    retrievePrice: (id: string) => {
      asked.push(id);
      const found = byId[id];
      if (found instanceof Error) return Promise.reject(found);
      return Promise.resolve(found);
    },
    priceIds,
    asked,
  };
};

const run = async (c: Ctx) => {
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

Deno.test('an unset price id → 500, and Stripe is never called', async () => {
  for (const priceIds of [{ annual: ANNUAL }, { monthly: MONTHLY }, {}]) {
    const c = ctx(undefined, priceIds);
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'price not configured' });
    assertEquals(c.asked, []);
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
