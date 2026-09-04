// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// The Circle price gate, lifted out of get-circle-prices so create-circle-checkout runs the
// SAME checks before it charges (#674 item 7). Two callers now, so a per-directory run of
// either misses a signature break in the other — run the whole suite from supabase/functions.
import { assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22';
import { logPriceRefusal, servableAmount, type PriceRefusal } from './circle-price.ts';

const price = (over: Partial<Stripe.Price> = {}): Stripe.Price =>
  ({
    id: 'price_monthly',
    object: 'price',
    active: true,
    currency: 'eur',
    unit_amount: 1200,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    ...over,
  }) as unknown as Stripe.Price;

const yearly = { interval: 'year', interval_count: 1 } as Stripe.Price['recurring'];

Deno.test('servableAmount: a live monthly Price serves its amount in Stripe’s own units', () => {
  assertEquals(servableAmount('monthly', price()), {
    ok: true,
    amount: { unitAmount: 1200, currency: 'eur' },
  });
  assertEquals(servableAmount('annual', price({ unit_amount: 9900, recurring: yearly })), {
    ok: true,
    amount: { unitAmount: 9900, currency: 'eur' },
  });
});

Deno.test('servableAmount: zero is a price', () => {
  assertEquals(servableAmount('monthly', price({ unit_amount: 0 })), {
    ok: true,
    amount: { unitAmount: 0, currency: 'eur' },
  });
});

Deno.test('servableAmount: each refusal names its own gate', () => {
  // The five arms, each with a distinct reason — this is what item 8 puts in the logs. A
  // test on the boolean alone would let two arms collapse into one line nobody can act on.
  const cases: Array<[Partial<Stripe.Price>, PriceRefusal]> = [
    [{ active: false }, 'inactive'],
    [{ recurring: null }, 'one_off'],
    [{ recurring: yearly }, 'wrong_interval'],
    [
      { recurring: { interval: 'month', interval_count: 3 } as Stripe.Price['recurring'] },
      'multi_period',
    ],
    [{ unit_amount: null }, 'no_unit_amount'],
  ];
  for (const [over, reason] of cases) {
    assertEquals(servableAmount('monthly', price(over)), { ok: false, reason }, reason);
  }
});

Deno.test('servableAmount: the interval is judged per plan, not globally', () => {
  // The monthly id pointed at a yearly Price (or the reverse) is the misconfiguration that
  // makes «€99/mese» a true string about the wrong plan.
  assertEquals(servableAmount('annual', price()), { ok: false, reason: 'wrong_interval' });
  assertEquals(servableAmount('monthly', price({ recurring: yearly })), {
    ok: false,
    reason: 'wrong_interval',
  });
});

Deno.test(
  'servableAmount: gates are checked in order — the first failing one names the reason',
  () => {
    // An archived one-off Price says `inactive`, not `one_off`: the operator fixes the first thing
    // the line names and re-reads the logs, so the order has to be stable.
    assertEquals(servableAmount('monthly', price({ active: false, recurring: null })), {
      ok: false,
      reason: 'inactive',
    });
  },
);

Deno.test(
  'logPriceRefusal: one line naming function, plan, gate and price id — never a member',
  () => {
    const lines: string[] = [];
    logPriceRefusal(
      { fn: 'create-circle-checkout', plan: 'annual', reason: 'inactive', priceId: 'price_x' },
      (line) => lines.push(line),
    );
    assertEquals(lines.length, 1);
    const [line] = lines;
    for (const needle of ['create-circle-checkout', 'annual', 'inactive', 'price_x']) {
      assertEquals(line.includes(needle), true, `line should name ${needle}: ${line}`);
    }
  },
);

Deno.test('logPriceRefusal: the unset-id arm logs too, without a price id', () => {
  // The sixth cause of the same generic 500 — a variable never set — used to be the one
  // arm the issue's per-gate fix would have missed.
  const lines: string[] = [];
  logPriceRefusal({ fn: 'get-circle-prices', plan: 'monthly', reason: 'unset' }, (l) =>
    lines.push(l),
  );
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes('unset'), true);
  assertEquals(lines[0].includes('undefined'), false);
});
