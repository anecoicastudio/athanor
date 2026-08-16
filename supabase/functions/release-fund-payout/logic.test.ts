import { assertEquals } from 'jsr:@std/assert@1';
import type Stripe from 'npm:stripe@22';
import { makeFakeDb } from '../_shared/fake-db.ts';
import {
  FUND_CURRENCY,
  payableCents,
  phaseReleasedNetCents,
  releasedNetCents,
  releaseFundPayout,
  type ReleaseFundPayoutCtx,
  transferGroup,
} from './logic.ts';

// The caps and refusals are this function's whole job (ruling #244: settled funds only,
// never past settled-minus-released; #232 rider: the amount derives from the cycle's
// declared retention; #231: no verification, no money). Rule #6 is asserted from this side
// too: the happy path performs NO database write — the webhook records the ledger row.

const ED = '00000000-0000-0000-0000-0000000000ed';
const WIN = '00000000-0000-0000-0000-00000000000c';
const OWNER = '11111111-1111-1111-1111-111111111111';
const PHASE = '22222222-2222-2222-2222-222222222222';
const OTHER_PHASE = '33333333-3333-3333-3333-333333333333';
const OTHER_ED = '00000000-0000-0000-0000-0000000000e2';

const edition = {
  phase: 'announcement',
  closure_reason: null,
  winner_candidacy_id: WIN,
  winner_confirmed_at: '2026-08-15T12:00:00.000Z',
  confirmed_pool_cents: 10000,
  split_pct: 10, // payable 9000
};
const account = { stripe_account_id: 'acct_win', charges_enabled: true, payouts_enabled: true };
// A verified phase of a published plan, costed at the cycle's whole payable so the phase
// cap does not shadow the cycle cap in tests that are about the cycle cap.
const phase = {
  amount_cents: 9000,
  verified_at: '2026-08-16T09:00:00.000Z',
  realization_plans: { edition_id: ED, published_at: '2026-08-16T08:00:00.000Z' },
};

type Scripted = {
  edition?: Record<string, unknown> | null;
  candidacy?: Record<string, unknown> | null;
  phase?: Record<string, unknown> | null;
  /** enumeration result for sweep mode — consumed BEFORE the per-phase lookup (FIFO) */
  due?: Record<string, unknown>[];
  transfers?: (Pick<Stripe.Transfer, 'amount' | 'amount_reversed'> & {
    metadata?: Stripe.Metadata;
  })[];
  availableCents?: number;
  account?: Record<string, unknown> | null;
  createError?: unknown;
  listError?: unknown;
  balanceError?: unknown;
};

function makeCtx(s: Scripted = {}) {
  // FIFO per key: in sweep mode the enumeration consumes the first
  // realization_plan_phases.select, and each candidate's own lookup consumes the next.
  const phaseResults = s.due
    ? [{ data: s.due }, ...s.due.map(() => ({ data: s.phase === undefined ? phase : s.phase }))]
    : [{ data: s.phase === undefined ? phase : s.phase }];
  const db = makeFakeDb({
    'fund_editions.select': [{ data: s.edition === undefined ? edition : s.edition }],
    'realization_plan_phases.select': phaseResults,
    'dream_candidacies.select': [
      { data: s.candidacy === undefined ? { profile_id: OWNER } : s.candidacy },
    ],
    'payout_accounts.select': [{ data: s.account === undefined ? account : s.account }],
  });
  const created: { params: Stripe.TransferCreateParams; opts: { idempotencyKey: string } }[] = [];
  const ctx: ReleaseFundPayoutCtx = {
    admin: db as unknown as ReleaseFundPayoutCtx['admin'],
    createTransfer: (params, opts) => {
      if (s.createError) return Promise.reject(s.createError);
      created.push({ params, opts });
      return Promise.resolve({ id: 'tr_1' } as Stripe.Transfer);
    },
    listTransfers: () =>
      s.listError
        ? Promise.reject(s.listError)
        : Promise.resolve((s.transfers ?? []) as Stripe.Transfer[]),
    retrieveBalance: () =>
      s.balanceError
        ? Promise.reject(s.balanceError)
        : Promise.resolve({
            available: [{ currency: FUND_CURRENCY, amount: s.availableCents ?? 1000000 }],
            pending: [{ currency: FUND_CURRENCY, amount: 0 }],
          } as unknown as Stripe.Balance),
  };
  return { ctx, db, created };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/release-fund-payout', { method: 'POST', body });
}

const good = () => post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 4000 }));

Deno.test('payable derives from the declared retention, floored — never chosen', () => {
  assertEquals(payableCents(10000, 10), 9000);
  assertEquals(payableCents(999, 10), 899); // floor(899.1) — mirrors the bigint CHECK
  assertEquals(payableCents(10000, 0), 10000);
  assertEquals(payableCents(10000, 100), 0);
});

Deno.test('released-net sums Stripe transfers minus their reversals', () => {
  assertEquals(releasedNetCents([]), 0);
  assertEquals(releasedNetCents([{ amount: 5000, amount_reversed: 0 }]), 5000);
  assertEquals(
    releasedNetCents([
      { amount: 5000, amount_reversed: 2000 },
      { amount: 1000, amount_reversed: 1000 },
    ]),
    3000, // a full reversal self-excludes; a partial nets against what remains (#244)
  );
});

Deno.test('per-phase released-net reads the attribution off Stripe metadata (#231)', () => {
  const transfers = [
    { amount: 5000, amount_reversed: 0, metadata: { plan_phase_id: PHASE } },
    { amount: 3000, amount_reversed: 1000, metadata: { plan_phase_id: PHASE } },
    { amount: 4000, amount_reversed: 0, metadata: { plan_phase_id: OTHER_PHASE } },
    { amount: 2000, amount_reversed: 0, metadata: {} }, // pre-plan corpus: no attribution
  ] as unknown as Pick<Stripe.Transfer, 'amount' | 'amount_reversed' | 'metadata'>[];
  assertEquals(phaseReleasedNetCents(transfers, PHASE), 7000); // 5000 + (3000 − 1000)
  assertEquals(phaseReleasedNetCents(transfers, OTHER_PHASE), 4000);
  // The cycle figure still counts every transfer, attributed or not.
  assertEquals(releasedNetCents(transfers), 13000);
});

Deno.test('non-JSON body → 400, nothing touched', async () => {
  const { ctx, db, created } = makeCtx();
  const res = await releaseFundPayout(ctx, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(db.calls.length, 0);
  assertEquals(created.length, 0);
});

Deno.test('malformed payloads → 400, nothing touched', async () => {
  for (const body of [
    '{}',
    JSON.stringify({ editionId: 'not-a-uuid', planPhaseId: PHASE, amountCents: 100 }),
    JSON.stringify({ editionId: ED, planPhaseId: 'not-a-uuid', amountCents: 100 }),
    // #231: an unattributed release is the ungated money FUND-53 forbids — the phase is
    // required, so the gate cannot be switched off by omitting a key.
    JSON.stringify({ editionId: ED, amountCents: 100 }),
    JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 0 }),
    JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: -5 }),
    JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 10.5 }),
    JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 100, extra: true }),
  ]) {
    const { ctx, db, created } = makeCtx();
    const res = await releaseFundPayout(ctx, post(body));
    assertEquals(res.status, 400, body);
    assertEquals((await res.json()).error, 'invalid payload');
    assertEquals(db.calls.length, 0);
    assertEquals(created.length, 0);
  }
});

Deno.test('unknown edition → 404', async () => {
  const { ctx, created } = makeCtx({ edition: null });
  const res = await releaseFundPayout(ctx, good());
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, 'edition not found');
  assertEquals(created.length, 0);
});

Deno.test('winner gates: none declared / not confirmed → 409', async () => {
  for (const [patch, message] of [
    [{ winner_candidacy_id: null }, 'no winner declared'],
    [{ winner_confirmed_at: null }, 'viability not confirmed'],
  ] as const) {
    const { ctx, created } = makeCtx({ edition: { ...edition, ...patch } });
    const res = await releaseFundPayout(ctx, good());
    assertEquals(res.status, 409, message);
    assertEquals((await res.json()).error, message);
    assertEquals(created.length, 0);
  }
});

Deno.test('phase gates: pre-announcement and non-realized closures refuse', async () => {
  for (const [patch, message] of [
    [{ phase: 'voting' }, 'release out of phase'],
    [{ phase: 'closed', closure_reason: 'realization_failed' }, 'cycle closed'],
    [{ phase: 'closed', closure_reason: 'voided_declined' }, 'cycle closed'],
  ] as const) {
    const { ctx, created } = makeCtx({ edition: { ...edition, ...patch } });
    const res = await releaseFundPayout(ctx, good());
    assertEquals(res.status, 409, message);
    assertEquals((await res.json()).error, message);
    assertEquals(created.length, 0);
  }
});

Deno.test('a closed+realized cycle still releases its payable remainder', async () => {
  // close_cycle('realized') accounted the FULL snapshot as disbursed (D34); a remainder
  // still untransferred at closure stays releasable under the same ledger cap.
  const { ctx, created } = makeCtx({
    edition: { ...edition, phase: 'closed', closure_reason: 'realized' },
  });
  const res = await releaseFundPayout(ctx, good());
  assertEquals(res.status, 200);
  assertEquals(created.length, 1);
});

Deno.test('missing snapshot → 409 no confirmed pool', async () => {
  const { ctx, created } = makeCtx({ edition: { ...edition, confirmed_pool_cents: null } });
  const res = await releaseFundPayout(ctx, good());
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'no confirmed pool');
  assertEquals(created.length, 0);
});

// ── #231, the gate ──────────────────────────────────────────────────────────────────────

Deno.test('THE GATE: a phase without recorded verification refuses, no Stripe call', async () => {
  const { ctx, created } = makeCtx({ phase: { ...phase, verified_at: null } });
  const res = await releaseFundPayout(ctx, good());
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'phase not verified');
  // Ex-ante: nothing reached Stripe. There is no release-then-reconcile path.
  assertEquals(created.length, 0);
});

Deno.test('plan-phase gates: unknown, foreign cycle, unpublished plan', async () => {
  for (const [scripted, status, message] of [
    [{ phase: null }, 404, 'plan phase not found'],
    [{ phase: { ...phase, realization_plans: null } }, 404, 'plan phase not found'],
    [
      { phase: { ...phase, realization_plans: { edition_id: OTHER_ED, published_at: 'x' } } },
      409,
      'plan phase belongs to another cycle',
    ],
    [
      { phase: { ...phase, realization_plans: { edition_id: ED, published_at: null } } },
      409,
      'plan not published',
    ],
  ] as const) {
    const { ctx, created } = makeCtx(scripted as Scripted);
    const res = await releaseFundPayout(ctx, good());
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, message);
    assertEquals(created.length, 0);
  }
});

Deno.test('the phase cap binds even when the cycle payable would allow it', async () => {
  // A phase costed at 5000 inside a 9000-payable cycle: 6000 clears the cycle cap and must
  // still refuse, or the plan's own costing stops governing the money it describes.
  const small = { ...phase, amount_cents: 5000 };
  const over = makeCtx({ phase: small });
  const overRes = await releaseFundPayout(
    over.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 6000 })),
  );
  assertEquals(overRes.status, 409);
  assertEquals((await overRes.json()).error, 'would exceed phase amount');
  assertEquals(over.created.length, 0);

  const at = makeCtx({ phase: small });
  const atRes = await releaseFundPayout(
    at.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 5000 })),
  );
  assertEquals(atRes.status, 200);
  assertEquals(at.created.length, 1);
});

Deno.test('the phase cap counts only what was released against THAT phase', async () => {
  // 4000 already released against another phase of the same cycle: this phase's own 5000
  // headroom is untouched by it, while the cycle cap sees both.
  const transfers = [
    { amount: 4000, amount_reversed: 0, metadata: { plan_phase_id: OTHER_PHASE } },
  ] as unknown as Pick<Stripe.Transfer, 'amount' | 'amount_reversed' | 'metadata'>[];
  const { ctx, created } = makeCtx({ phase: { ...phase, amount_cents: 5000 }, transfers });
  const res = await releaseFundPayout(
    ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 5000 })),
  );
  assertEquals(res.status, 200); // 5000 ≤ phase 5000, and 5000 ≤ payable 9000 − 4000
  assertEquals(created.length, 1);
  assertEquals((await res.json()).phaseReleasedBeforeCents, 0);
});

Deno.test('a partly-released phase has only its remainder left', async () => {
  const transfers = [
    { amount: 3000, amount_reversed: 0, metadata: { plan_phase_id: PHASE } },
  ] as unknown as Pick<Stripe.Transfer, 'amount' | 'amount_reversed' | 'metadata'>[];
  const over = makeCtx({ phase: { ...phase, amount_cents: 5000 }, transfers });
  const overRes = await releaseFundPayout(
    over.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 2001 })),
  );
  assertEquals(overRes.status, 409);
  assertEquals((await overRes.json()).error, 'would exceed phase amount');

  const at = makeCtx({ phase: { ...phase, amount_cents: 5000 }, transfers });
  const atRes = await releaseFundPayout(
    at.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 2000 })),
  );
  assertEquals(atRes.status, 200);
  assertEquals(at.created.length, 1);
});

Deno.test('destination gates: erased winner, no account, unready account → 409', async () => {
  for (const [scripted, message] of [
    [{ candidacy: { profile_id: null } }, 'no payout account'],
    [{ candidacy: null }, 'no payout account'],
    [{ account: null }, 'no payout account'],
    [{ account: { ...account, charges_enabled: false } }, 'payout account not ready'],
    [{ account: { ...account, payouts_enabled: false } }, 'payout account not ready'],
  ] as const) {
    const { ctx, created } = makeCtx(scripted as Scripted);
    const res = await releaseFundPayout(ctx, good());
    assertEquals(res.status, 409, message);
    assertEquals((await res.json()).error, message);
    assertEquals(created.length, 0);
  }
});

Deno.test('the #244 cap: amount past settled-minus-released refuses, at it passes', async () => {
  // pool 10000, split 10 → payable 9000; 5000 already released → headroom 4000.
  const prior = [{ amount: 5000, amount_reversed: 0 }];
  const over = makeCtx({ transfers: prior });
  const overRes = await releaseFundPayout(
    over.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 4001 })),
  );
  assertEquals(overRes.status, 409);
  assertEquals((await overRes.json()).error, 'would exceed declared payable');
  assertEquals(over.created.length, 0);

  const at = makeCtx({ transfers: prior });
  const atRes = await releaseFundPayout(
    at.ctx,
    post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 4000 })),
  );
  assertEquals(atRes.status, 200);
  assertEquals(at.created.length, 1);
});

Deno.test(
  'a reversal restores headroom — the return nets against the unreleased (#244)',
  async () => {
    const { ctx, created } = makeCtx({ transfers: [{ amount: 5000, amount_reversed: 2000 }] });
    const res = await releaseFundPayout(
      ctx,
      // 9000 − 3000 = 6000 cycle headroom; the phase is costed at the full payable.
      post(JSON.stringify({ editionId: ED, planPhaseId: PHASE, amountCents: 6000 })),
    );
    assertEquals(res.status, 200);
    assertEquals(created.length, 1);
  },
);

Deno.test('settled gate: amount past the available balance → 409 unsettled funds', async () => {
  const { ctx, created } = makeCtx({ availableCents: 3999 });
  const res = await releaseFundPayout(ctx, good());
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'unsettled funds');
  assertEquals(created.length, 0);
});

Deno.test(
  'happy path: one transfer, derived basis + phase in metadata, keyed idempotency, NO db write',
  async () => {
    const { ctx, db, created } = makeCtx({ transfers: [{ amount: 1000, amount_reversed: 0 }] });
    const res = await releaseFundPayout(ctx, good());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      transferId: 'tr_1',
      editionId: ED,
      planPhaseId: PHASE,
      amountCents: 4000,
      payableCents: 9000,
      releasedBeforeCents: 1000,
      phaseReleasedBeforeCents: 0,
      destinationAccountId: 'acct_win',
    });
    assertEquals(created.length, 1);
    const { params, opts } = created[0];
    assertEquals(params.amount, 4000);
    assertEquals(params.currency, FUND_CURRENCY);
    assertEquals(params.destination, 'acct_win');
    assertEquals(params.transfer_group, transferGroup(ED));
    assertEquals(params.metadata, {
      kind: 'fund_payout',
      edition_id: ED,
      plan_phase_id: PHASE,
      pool_cents: '10000',
      split_pct: '10',
      payable_cents: '9000',
    });
    // The phase is deliberately NOT in the key: two phases racing the same released-net
    // reading must collide rather than both mint against one headroom.
    assertEquals(opts.idempotencyKey, `fund_payout:${ED}:1000`);
    // Rule #6: the execution requests, the webhook records — reads only, never a write.
    assertEquals(
      db.calls.map((c) => c.op),
      ['select', 'select', 'select', 'select'],
    );
  },
);

Deno.test(
  'Stripe failure mapping: idempotency conflict and balance gate are refusals',
  async () => {
    for (const [createError, status, message] of [
      [{ type: 'StripeIdempotencyError' }, 409, 'conflicting release in flight'],
      [{ code: 'idempotency_error' }, 409, 'conflicting release in flight'],
      [{ code: 'balance_insufficient' }, 409, 'unsettled funds'],
      [{ code: 'account_invalid' }, 502, 'transfer failed'],
    ] as const) {
      const { ctx } = makeCtx({ createError });
      const res = await releaseFundPayout(ctx, good());
      assertEquals(res.status, status, message);
      assertEquals((await res.json()).error, message);
    }
  },
);

Deno.test('Stripe read failures are failures, not refusals — 502', async () => {
  const list = makeCtx({ listError: new Error('down') });
  const listRes = await releaseFundPayout(list.ctx, good());
  assertEquals(listRes.status, 502);
  assertEquals((await listRes.json()).error, 'transfer listing failed');

  const bal = makeCtx({ balanceError: new Error('down') });
  const balRes = await releaseFundPayout(bal.ctx, good());
  assertEquals(balRes.status, 502);
  assertEquals((await balRes.json()).error, 'balance lookup failed');
});

// ── #248's sweep, live since #231 ───────────────────────────────────────────────────────

Deno.test('sweep: no verified phase anywhere → zero due, no Stripe call', async () => {
  const { ctx, db, created } = makeCtx({ due: [] });
  const res = await releaseFundPayout(ctx, post(JSON.stringify({ mode: 'sweep' })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    mode: 'sweep',
    dueTranches: 0,
    transfersRequested: 0,
    refusals: {},
  });
  // One read — the enumeration — and nothing else.
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].table, 'realization_plan_phases');
  assertEquals(created.length, 0);
});

Deno.test('sweep enumerates verified phases and releases each phase’s remainder', async () => {
  const { ctx, created } = makeCtx({
    due: [{ id: PHASE, realization_plans: { edition_id: ED } }],
    phase: { ...phase, amount_cents: 5000 },
  });
  const res = await releaseFundPayout(ctx, post(JSON.stringify({ mode: 'sweep' })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    mode: 'sweep',
    dueTranches: 1,
    transfersRequested: 1,
    refusals: {},
  });
  assertEquals(created.length, 1);
  // The amount is the PHASE's own costing, not a sweep-chosen figure.
  assertEquals(created[0].params.amount, 5000);
  assertEquals(created[0].params.metadata, {
    kind: 'fund_payout',
    edition_id: ED,
    plan_phase_id: PHASE,
    pool_cents: '10000',
    split_pct: '10',
    payable_cents: '9000',
  });
});

Deno.test('sweep: an already-paid phase refuses and is counted, not raised', async () => {
  const transfers = [
    { amount: 5000, amount_reversed: 0, metadata: { plan_phase_id: PHASE } },
  ] as unknown as Pick<Stripe.Transfer, 'amount' | 'amount_reversed' | 'metadata'>[];
  const { ctx, created } = makeCtx({
    due: [{ id: PHASE, realization_plans: { edition_id: ED } }],
    phase: { ...phase, amount_cents: 5000 },
    transfers,
  });
  const res = await releaseFundPayout(ctx, post(JSON.stringify({ mode: 'sweep' })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    mode: 'sweep',
    dueTranches: 1,
    transfersRequested: 0,
    refusals: { 'phase fully released': 1 },
  });
  assertEquals(created.length, 0);
});

Deno.test('sweep: one cycle’s refusal does not stop another cycle from paying', async () => {
  // The unready account refuses; the sweep still reaches and pays the second candidate.
  const db = makeFakeDb({
    'realization_plan_phases.select': [
      {
        data: [
          { id: PHASE, realization_plans: { edition_id: ED } },
          { id: OTHER_PHASE, realization_plans: { edition_id: OTHER_ED } },
        ],
      },
      { data: { ...phase, amount_cents: 5000 } },
      {
        data: {
          ...phase,
          amount_cents: 5000,
          realization_plans: { ...phase.realization_plans, edition_id: OTHER_ED },
        },
      },
    ],
    'fund_editions.select': [{ data: edition }, { data: edition }],
    'dream_candidacies.select': [{ data: { profile_id: OWNER } }, { data: { profile_id: OWNER } }],
    'payout_accounts.select': [{ data: { ...account, payouts_enabled: false } }, { data: account }],
  });
  const created: { params: Stripe.TransferCreateParams }[] = [];
  const ctx: ReleaseFundPayoutCtx = {
    admin: db as unknown as ReleaseFundPayoutCtx['admin'],
    createTransfer: (params) => {
      created.push({ params });
      return Promise.resolve({ id: 'tr_1' } as Stripe.Transfer);
    },
    listTransfers: () => Promise.resolve([]),
    retrieveBalance: () =>
      Promise.resolve({
        available: [{ currency: FUND_CURRENCY, amount: 1000000 }],
        pending: [{ currency: FUND_CURRENCY, amount: 0 }],
      } as unknown as Stripe.Balance),
  };
  const res = await releaseFundPayout(ctx, post(JSON.stringify({ mode: 'sweep' })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    mode: 'sweep',
    dueTranches: 2,
    transfersRequested: 1,
    refusals: { 'payout account not ready': 1 },
  });
  assertEquals(created.length, 1);
  assertEquals(created[0].params.metadata, {
    kind: 'fund_payout',
    edition_id: OTHER_ED,
    plan_phase_id: OTHER_PHASE,
    pool_cents: '10000',
    split_pct: '10',
    payable_cents: '9000',
  });
});

Deno.test('sweep: the enumeration asks only for verified phases of published plans', async () => {
  const { ctx, db } = makeCtx({ due: [] });
  await releaseFundPayout(ctx, post(JSON.stringify({ mode: 'sweep' })));
  assertEquals(db.calls[0].filters, [
    ['not', 'verified_at', 'is', null],
    ['not', 'realization_plans.published_at', 'is', null],
  ]);
});

Deno.test('sweep payload is strict — extra keys and unknown modes stay refusals', async () => {
  for (const body of [
    JSON.stringify({ mode: 'sweep', editionId: ED }),
    JSON.stringify({ mode: 'sweep', amountCents: 100 }),
    JSON.stringify({ mode: 'decay' }),
  ]) {
    const { ctx, db, created } = makeCtx();
    const res = await releaseFundPayout(ctx, post(body));
    assertEquals(res.status, 400, body);
    assertEquals((await res.json()).error, 'invalid payload');
    assertEquals(db.calls.length, 0);
    assertEquals(created.length, 0);
  }
});
