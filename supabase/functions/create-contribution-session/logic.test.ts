// deno test supabase/functions/create-contribution-session/ — runs in CI (edge job) and locally.
// Characterization tests for the contribution amount floor + legal-flag gate + session params.
// All db I/O through injected fakes; Stripe as a capability closure (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  CONTRIBUTION_OPEN_PHASES,
  createContributionSession,
  feeCoverage,
  isValidContributionAmount,
  STRIPE_FEE_BPS,
  STRIPE_FEE_FIXED_CENTS,
  type ContributionSessionCtx,
} from './logic.ts';

const PROFILE = 'prof-1';
const EDITION = 'ed-1';

const editionRow = (over: Record<string, unknown> = {}) => ({
  id: EDITION,
  contributions_enabled: true,
  // A real open phase from the #372 six-value CHECK — the old 'contributions'
  // placeholder was never a valid value and now trips the D34 window gate.
  phase: 'voting',
  ...over,
});

type Ctx = ContributionSessionCtx & {
  db: FakeDb;
  created: Stripe.Checkout.SessionCreateParams[];
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  opts: { sessionUrl?: string | null; throwOnCreate?: boolean } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  return {
    userClient: db as unknown as ContributionSessionCtx['userClient'],
    createCheckoutSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        url: opts.sessionUrl === undefined ? 'https://checkout.stripe.test/cs_1' : opts.sessionUrl,
      } as Stripe.Checkout.Session);
    },
    appBase: 'athanor://',
    db,
    created,
  };
};

const run = async (c: Ctx, amountCents: number, coverFees?: unknown) => {
  const res = await createContributionSession(c, {
    profileId: PROFILE,
    editionId: EDITION,
    amountCents,
    coverFees: coverFees as boolean | undefined,
  });
  return { res, body: await res.json() };
};

// ── amount floor ─────────────────────────────────────────────────────────────

Deno.test('isValidContributionAmount: boundary cases', () => {
  assertEquals(isValidContributionAmount(99), false); // below €1
  assertEquals(isValidContributionAmount(100), true); // exactly €1
  assertEquals(isValidContributionAmount(100.5), false); // non-integer minor units
  assertEquals(isValidContributionAmount(0), false);
  assertEquals(isValidContributionAmount(-100), false);
  assertEquals(isValidContributionAmount(NaN), false);
  assertEquals(isValidContributionAmount(5_000_000), true); // no max
});

Deno.test('amount below the floor → 400, no db read, Stripe never called', async () => {
  for (const amount of [99, 100.5, 0, -1]) {
    const c = ctx();
    const { res, body } = await run(c, amount);
    assertEquals(res.status, 400);
    assertEquals(body, { error: 'amount must be at least €1' });
    assertEquals(c.db.calls.length, 0);
    assertEquals(c.created.length, 0);
  }
});

// ── edition load + legal flag ────────────────────────────────────────────────

Deno.test('edition lookup error → 500; missing edition → 404', async () => {
  const err = ctx({ 'fund_editions.select': [{ error: { message: 'boom' } }] });
  const errRun = await run(err, 500);
  assertEquals(errRun.res.status, 500);
  assertEquals(errRun.body, { error: 'edition lookup failed' });

  const missing = ctx({ 'fund_editions.select': [{ data: null }] });
  const missRun = await run(missing, 500);
  assertEquals(missRun.res.status, 404);
  assertEquals(missRun.body, { error: 'edition not found' });
});

Deno.test('contributions_enabled false → 403, Stripe never called', async () => {
  const c = ctx({
    'fund_editions.select': [{ data: editionRow({ contributions_enabled: false }) }],
  });
  const { res, body } = await run(c, 500);
  assertEquals(res.status, 403);
  assertEquals(body, { error: 'contributions are not open' });
  assertEquals(c.created.length, 0);
});

// ── contribution window (#222 / D34) ─────────────────────────────────────────

Deno.test('no open cycle (stale edition id) → 404, Stripe never called', async () => {
  const c = ctx({ 'fund_editions.select': [{ data: null }] });
  const { res, body } = await run(c, 100);
  assertEquals(res.status, 404);
  assertEquals(body, { error: 'edition not found' });
  assertEquals(c.created.length, 0);
});

Deno.test("closed phase → 403 'the cycle is closed', Stripe never called", async () => {
  // 'closed' is the six-value CHECK's terminal phase; 'contributions' pins the
  // fail-closed branch — an unknown phase refuses too, it never reaches Stripe.
  for (const phase of ['closed', 'contributions']) {
    const c = ctx({ 'fund_editions.select': [{ data: editionRow({ phase }) }] });
    const { res, body } = await run(c, 100);
    assertEquals(res.status, 403);
    assertEquals(body, { error: 'the cycle is closed' });
    assertEquals(c.created.length, 0);
  }
});

Deno.test('every open phase accepts — candidacy through realization (D34)', async () => {
  assertEquals(CONTRIBUTION_OPEN_PHASES, [
    'candidacy',
    'screening',
    'voting',
    'announcement',
    'realization',
  ]);
  for (const phase of CONTRIBUTION_OPEN_PHASES) {
    const c = ctx({ 'fund_editions.select': [{ data: editionRow({ phase }) }] });
    const { res, body } = await run(c, 100);
    assertEquals(res.status, 200, `phase ${phase} must accept`);
    assertEquals(body, { url: 'https://checkout.stripe.test/cs_1' });
    assertEquals(c.created.length, 1);
  }
});

// ── session params + happy path ──────────────────────────────────────────────

Deno.test('happy path → { url }; eur, server-validated amount, kind contribution', async () => {
  const c = ctx({ 'fund_editions.select': [{ data: editionRow() }] });
  const { res, body } = await run(c, 2500);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://checkout.stripe.test/cs_1' });

  // edition queried by id
  const q = c.db.calls[0];
  assertEquals(q.table, 'fund_editions');
  assert(q.filters.some(([f, col, v]) => f === 'eq' && col === 'id' && v === EDITION));

  assertEquals(c.created.length, 1);
  const params = c.created[0];
  assertEquals(params.mode, 'payment');
  // unit_amount is the floor-validated server amount — nothing else ever reaches Stripe.
  assertEquals(params.line_items, [
    {
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: 2500,
        product_data: { name: 'Dai Vita al Tuo Sogno — contributo' },
      },
    },
  ]);
  // gift_cents/coverage_cents joined the metadata with #236 — the webhook reconciles the
  // split against Stripe's amount_total, so both figures travel even on an uncovered charge.
  assertEquals(params.metadata, {
    kind: 'contribution',
    edition_id: EDITION,
    profile_id: PROFILE,
    gift_cents: '2500',
    coverage_cents: '0',
  });
  assertEquals(params.success_url, 'athanor://annual?contrib=success');
  assertEquals(params.cancel_url, 'athanor://annual?contrib=cancel');
});

// ── the optional fee coverage (#236 / FUND-51) ───────────────────────────────
//
// This copy of the formula is the AUTHORITY: the client's figure is display only. The same
// three fixtures are asserted in packages/core/src/fund/fees.test.ts — `supabase/functions`
// is outside the pnpm workspace and cannot import @athanor/core, so the two implementations
// are kept honest by pinning identical values on both sides. Change one, change both.

Deno.test('the Stripe rate constants match the disclosure, and core', () => {
  assertEquals(STRIPE_FEE_BPS, 150); // 1.5%
  assertEquals(STRIPE_FEE_FIXED_CENTS, 25); // €0,25
});

Deno.test('feeCoverage: the recursive gross-up, same fixtures as packages/core', () => {
  // €1,00 → €1,27 charged, €0,27 coverage — the figure #236 quotes.
  assertEquals(feeCoverage(100), { giftCents: 100, coverageCents: 27, chargedCents: 127 });
  // exact division: 985 / 0.985 = 1000, nothing rounded
  assertEquals(feeCoverage(960), { giftCents: 960, coverageCents: 40, chargedCents: 1000 });
  // rounds UP, never to nearest: (238 + 25) / 0.985 = 267.005… → 268
  assertEquals(feeCoverage(238), { giftCents: 238, coverageCents: 30, chargedCents: 268 });
});

Deno.test('feeCoverage never leaves the fund short of the gift', () => {
  // Models Stripe's own deduction. A naive `gift + fee(gift)` charge fails this — the cut is
  // a percentage of the CHARGE, so covering it enlarges the thing being cut.
  const stripeFeeOn = (charged: number) =>
    Math.round((charged * STRIPE_FEE_BPS) / 10_000) + STRIPE_FEE_FIXED_CENTS;
  for (let gift = 100; gift <= 100_000; gift += 37) {
    const { chargedCents } = feeCoverage(gift);
    const net = chargedCents - stripeFeeOn(chargedCents);
    assert(net >= gift, `gift ${gift}: net ${net} is short`);
    assert(
      net <= gift + 1,
      `gift ${gift}: net ${net} overshoots — coverage is a cost, not a margin`,
    );
  }
});

Deno.test(
  'coverage taken → the CHARGE is grossed up, the gift is itemised separately',
  async () => {
    const c = ctx({ 'fund_editions.select': [{ data: editionRow() }] });
    const { res, body } = await run(c, 100, true);
    assertEquals(res.status, 200);
    assertEquals(body, { url: 'https://checkout.stripe.test/cs_1' });

    const params = c.created[0];
    // Two line items, so the payer's own Stripe receipt shows what the coverage was — the
    // whole point of #236 is that the deduction is disclosed rather than absorbed silently.
    assertEquals(params.line_items, [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: 100,
          product_data: { name: 'Dai Vita al Tuo Sogno — contributo' },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: 27,
          product_data: { name: 'Dai Vita al Tuo Sogno — copertura costi di pagamento' },
        },
      },
    ]);
    // The webhook reads BOTH figures and reconciles them against amount_total (127).
    assertEquals(params.metadata, {
      kind: 'contribution',
      edition_id: EDITION,
      profile_id: PROFILE,
      gift_cents: '100',
      coverage_cents: '27',
    });
  },
);

Deno.test(
  'coverage declined → byte-identical to the uncovered flow, coverage_cents 0',
  async () => {
    for (const declined of [undefined, false]) {
      const c = ctx({ 'fund_editions.select': [{ data: editionRow() }] });
      const { res } = await run(c, 2500, declined);
      assertEquals(res.status, 200);
      const params = c.created[0];
      assertEquals(params.line_items?.length, 1);
      assertEquals(params.line_items?.[0].price_data?.unit_amount, 2500);
      assertEquals(params.metadata, {
        kind: 'contribution',
        edition_id: EDITION,
        profile_id: PROFILE,
        gift_cents: '2500',
        coverage_cents: '0',
      });
    }
  },
);

Deno.test('a non-boolean coverage flag is DECLINED, never truthy-coerced', async () => {
  // The flag arrives from `await req.json()` — untyped at runtime. Money code fails closed:
  // only literal `true` charges a payer more than the amount they chose, because CRD Art. 22
  // wants express consent and 'yes'/1/{} are not it.
  for (const junk of ['true', 'yes', 1, {}, [], 'false']) {
    const c = ctx({ 'fund_editions.select': [{ data: editionRow() }] });
    const { res } = await run(c, 100, junk);
    assertEquals(res.status, 200);
    assertEquals(c.created[0].line_items?.length, 1);
    assertEquals(c.created[0].line_items?.[0].price_data?.unit_amount, 100);
    assertEquals((c.created[0].metadata as Record<string, string>).coverage_cents, '0');
  }
});

Deno.test('the €1 floor is on the GIFT — coverage cannot lift a sub-€1 contribution', async () => {
  // €0,99 + €0,30 clears €1 as a charge and must still be refused: the fund would receive
  // less than the declared minimum, and the floor is a promise about the fund's side.
  const c = ctx();
  const { res, body } = await run(c, 99, true);
  assertEquals(res.status, 400);
  assertEquals(body, { error: 'amount must be at least €1' });
  assertEquals(c.db.calls.length, 0);
  assertEquals(c.created.length, 0);
});

Deno.test('session without url / Stripe throw → clean 500, never Stripe internals', async () => {
  const noUrl = await run(
    ctx({ 'fund_editions.select': [{ data: editionRow() }] }, { sessionUrl: null }),
    100,
  );
  assertEquals(noUrl.res.status, 500);
  assertEquals(noUrl.body, { error: 'could not start checkout' });

  const thrown = await run(
    ctx({ 'fund_editions.select': [{ data: editionRow() }] }, { throwOnCreate: true }),
    100,
  );
  assertEquals(thrown.res.status, 500);
  assertEquals(thrown.body, { error: 'could not start checkout' });
});
