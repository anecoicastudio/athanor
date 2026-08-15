import { assertEquals } from 'jsr:@std/assert@1';
import { closeCycle, type CloseCycleDb, type CloseRow, type RolloverRow } from './logic.ts';

// The transactions, the ladders and the carry arithmetic live in SQL (close_cycle() and
// rollover_voided(), pgTAP 0110). What this layer owes: parse strictly (op shape and the
// released-amount rule included), route the op to its ONE rpc and nothing else, map each
// refusal to a status, and return the outcome untouched.

const ED = '00000000-0000-0000-0000-0000000000ed';
const SUC = '00000000-0000-0000-0000-00000000000b';

const successor = {
  targetAt: '2027-06-01T00:00:00.000Z',
  goalCents: 5000000,
  minFundingCents: 100000,
  minVoters: 5,
  minCandidacies: 3,
  splitPct: 10,
  costFeeStatement: 'costs statement',
  equityDeclared: 'none',
};

type RpcResult = {
  data: CloseRow[] | RolloverRow[] | null;
  error: { code?: string; message: string } | null;
};

function fakeDb(result: RpcResult) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve(result);
  };
  return { db: { rpc } as unknown as CloseCycleDb, calls };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/close-cycle', { method: 'POST', body });
}

const closed: CloseRow = { successor_id: SUC, closure_reason: 'realized', carried_in_cents: 250 };

Deno.test('non-JSON body → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: [closed], error: null });
  const res = await closeCycle(db, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(calls.length, 0);
});

Deno.test('missing/invalid fields → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: [closed], error: null });
  for (const body of [
    '{}',
    JSON.stringify({
      editionId: 'not-a-uuid',
      op: 'close',
      outcome: 'realized',
      evidence: 'e',
      successor,
    }),
    JSON.stringify({ editionId: ED, op: 'end', successor }),
    JSON.stringify({ editionId: ED, op: 'close', outcome: 'voided', evidence: 'e', successor }),
    JSON.stringify({ editionId: ED, op: 'close', outcome: 'realized', evidence: '   ', successor }),
    JSON.stringify({ editionId: ED, op: 'close', outcome: 'realized', evidence: 'e' }), // no successor
    JSON.stringify({
      editionId: ED,
      op: 'close',
      outcome: 'realized',
      evidence: 'e',
      successor: { ...successor, goalCents: 0 },
    }),
    JSON.stringify({
      editionId: ED,
      op: 'close',
      outcome: 'realized',
      evidence: 'e',
      successor: { ...successor, splitPct: 101 },
    }),
    JSON.stringify({
      editionId: ED,
      op: 'close',
      outcome: 'realized',
      evidence: 'e',
      successor: { ...successor, costFeeStatement: ' ' },
    }),
    JSON.stringify({ editionId: ED, op: 'rollover' }), // no successor
  ]) {
    const res = await closeCycle(db, post(body));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'invalid payload');
  }
  assertEquals(calls.length, 0);
});

Deno.test(
  'released travels only with the D33 failure — both directions 400, no db call',
  async () => {
    const { db, calls } = fakeDb({ data: [closed], error: null });
    for (const body of [
      // realized must NOT carry a released amount
      JSON.stringify({
        editionId: ED,
        op: 'close',
        outcome: 'realized',
        evidence: 'e',
        releasedCents: 1,
        successor,
      }),
      // realization_failed must carry one
      JSON.stringify({
        editionId: ED,
        op: 'close',
        outcome: 'realization_failed',
        evidence: 'e',
        successor,
      }),
    ]) {
      const res = await closeCycle(db, post(body));
      assertEquals(res.status, 400);
    }
    assertEquals(calls.length, 0);
  },
);

Deno.test('close realized routes to close_cycle with a null released amount', async () => {
  const { db, calls } = fakeDb({ data: [closed], error: null });
  const res = await closeCycle(
    db,
    post(
      JSON.stringify({
        editionId: ED,
        op: 'close',
        outcome: 'realized',
        evidence: 'delivered per plan',
        successor,
      }),
    ),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    editionId: ED,
    outcome: 'realized',
    successorId: SUC,
    carriedInCents: 250,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, 'close_cycle');
  assertEquals(calls[0].args.p_outcome, 'realized');
  assertEquals(calls[0].args.p_released_cents, null);
  assertEquals(calls[0].args.p_evidence, 'delivered per plan');
  assertEquals(calls[0].args.p_target_at, successor.targetAt);
  assertEquals(calls[0].args.p_min_voters, 5);
});

Deno.test('close realization_failed forwards the released amount', async () => {
  const failedRow: CloseRow = {
    successor_id: SUC,
    closure_reason: 'realization_failed',
    carried_in_cents: 7000,
  };
  const { db, calls } = fakeDb({ data: [failedRow], error: null });
  const res = await closeCycle(
    db,
    post(
      JSON.stringify({
        editionId: ED,
        op: 'close',
        outcome: 'realization_failed',
        evidence: 'first tranche released, no delivery',
        releasedCents: 3000,
        successor,
      }),
    ),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'realization_failed');
  assertEquals(calls[0].args.p_released_cents, 3000);
});

Deno.test('rollover routes to rollover_voided and returns the carried amount', async () => {
  const row: RolloverRow = { successor_id: SUC, carried_in_cents: 150000 };
  const { db, calls } = fakeDb({ data: [row], error: null });
  const res = await closeCycle(
    db,
    post(JSON.stringify({ editionId: ED, op: 'rollover', successor })),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { editionId: ED, successorId: SUC, carriedInCents: 150000 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, 'rollover_voided');
  assertEquals(calls[0].args.p_edition_id, ED);
  assertEquals(calls[0].args.p_cost_fee_statement, 'costs statement');
});

Deno.test('each SQL refusal maps to its status', async () => {
  const cases: [string, number][] = [
    ['edition not found', 404],
    ['unknown outcome', 400],
    ['closure out of phase', 409],
    ['no winner declared', 409],
    ['viability not confirmed', 409],
    ['evidence required', 400],
    ['released not applicable', 400],
    ['released required', 400],
    ['released out of range', 400],
  ];
  for (const [message, status] of cases) {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message } });
    const res = await closeCycle(
      db,
      post(
        JSON.stringify({
          editionId: ED,
          op: 'close',
          outcome: 'realized',
          evidence: 'e',
          successor,
        }),
      ),
    );
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('each rollover refusal maps to its status', async () => {
  const cases: [string, number][] = [
    ['edition not found', 404],
    ['cycle not closed', 409],
    ['predecessor not voided', 409],
    ['already rolled over', 409],
    ['another cycle is open', 409],
  ];
  for (const [message, status] of cases) {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message } });
    const res = await closeCycle(
      db,
      post(JSON.stringify({ editionId: ED, op: 'rollover', successor })),
    );
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('an unknown db error is a failure, not a refusal — 502', async () => {
  for (const err of [
    { code: 'P0001', message: 'something novel' },
    { code: '23505', message: 'duplicate key value violates unique constraint' },
    { message: 'network down' },
  ]) {
    const { db } = fakeDb({ data: null, error: err });
    const closeRes = await closeCycle(
      db,
      post(
        JSON.stringify({
          editionId: ED,
          op: 'close',
          outcome: 'realized',
          evidence: 'e',
          successor,
        }),
      ),
    );
    assertEquals(closeRes.status, 502);
    assertEquals((await closeRes.json()).error, 'closure failed');
    const rollRes = await closeCycle(
      db,
      post(JSON.stringify({ editionId: ED, op: 'rollover', successor })),
    );
    assertEquals(rollRes.status, 502);
    assertEquals((await rollRes.json()).error, 'rollover failed');
  }
});

Deno.test('an empty result set is a failure — 502', async () => {
  const { db } = fakeDb({ data: [], error: null });
  const closeRes = await closeCycle(
    db,
    post(
      JSON.stringify({ editionId: ED, op: 'close', outcome: 'realized', evidence: 'e', successor }),
    ),
  );
  assertEquals(closeRes.status, 502);
  assertEquals((await closeRes.json()).error, 'closure returned no outcome');
  const rollRes = await closeCycle(
    db,
    post(JSON.stringify({ editionId: ED, op: 'rollover', successor })),
  );
  assertEquals(rollRes.status, 502);
  assertEquals((await rollRes.json()).error, 'rollover returned no outcome');
});
