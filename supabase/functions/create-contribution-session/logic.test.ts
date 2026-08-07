// deno test supabase/functions/create-contribution-session/ — runs in CI (edge job) and locally.
// Characterization tests for the contribution amount floor + legal-flag gate + session params.
// All db I/O through injected fakes; Stripe as a capability closure (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  createContributionSession,
  isValidContributionAmount,
  type ContributionSessionCtx,
} from './logic.ts';

const PROFILE = 'prof-1';
const EDITION = 'ed-1';

const editionRow = (over: Record<string, unknown> = {}) => ({
  id: EDITION,
  contributions_enabled: true,
  phase: 'contributions',
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

const run = async (c: Ctx, amountCents: number) => {
  const res = await createContributionSession(c, {
    profileId: PROFILE,
    editionId: EDITION,
    amountCents,
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
  assertEquals(params.metadata, { kind: 'contribution', edition_id: EDITION, profile_id: PROFILE });
  assertEquals(params.success_url, 'athanor://annual?contrib=success');
  assertEquals(params.cancel_url, 'athanor://annual?contrib=cancel');
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
