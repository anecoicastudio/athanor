import { assertEquals } from 'jsr:@std/assert@1';
import { announceCycle, type AnnounceCycleDb, type EntryRow } from './logic.ts';

// The transactions, the ladders and the shortfall gate live in SQL (enter_announcement()
// and record_winner_decision(), pgTAP 0109). What this layer owes: parse strictly, route
// the op to its ONE rpc and nothing else, map each refusal to a status, and return the
// outcome untouched.

const ED = '00000000-0000-0000-0000-0000000000ed';

type RpcResult = {
  data: EntryRow[] | string | null;
  error: { code?: string; message: string } | null;
};

function fakeDb(result: RpcResult) {
  const calls: { fn: string; args: unknown }[] = [];
  const rpc = (fn: string, args: unknown) => {
    calls.push({ fn, args });
    return Promise.resolve(result);
  };
  return { db: { rpc } as unknown as AnnounceCycleDb, calls };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/announce-cycle', { method: 'POST', body });
}

Deno.test('non-JSON body → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'confirmed', error: null });
  const res = await announceCycle(db, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(calls.length, 0);
});

Deno.test('missing/invalid fields → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'confirmed', error: null });
  for (const body of [
    '{}',
    '{"editionId":"not-a-uuid","op":"enter"}',
    `{"editionId":"${ED}","op":"snapshot"}`,
    `{"editionId":"${ED}"}`,
  ]) {
    const res = await announceCycle(db, post(body));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'invalid payload');
  }
  assertEquals(calls.length, 0);
});

Deno.test('enter routes to enter_announcement and returns the outcome row', async () => {
  const { db, calls } = fakeDb({
    data: [{ outcome: 'announced', pool_cents: 4832810, voters: 6 }],
    error: null,
  });
  const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op: 'enter' })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    editionId: ED,
    outcome: 'announced',
    poolCents: 4832810,
    voters: 6,
  });
  assertEquals(calls, [{ fn: 'enter_announcement', args: { p_edition_id: ED } }]);
});

Deno.test('a void outcome rides the same 200 — the void is a result, not an error', async () => {
  const { db } = fakeDb({
    data: [{ outcome: 'voided_underfunded', pool_cents: 500, voters: 6 }],
    error: null,
  });
  const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op: 'enter' })));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).outcome, 'voided_underfunded');
});

Deno.test(
  'confirm and decline route to record_winner_decision with the op as decision',
  async () => {
    for (const [op, outcome] of [
      ['confirm', 'confirmed'],
      ['decline', 'voided_declined'],
    ] as const) {
      const { db, calls } = fakeDb({ data: outcome, error: null });
      const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op })));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { editionId: ED, outcome });
      assertEquals(calls, [
        { fn: 'record_winner_decision', args: { p_edition_id: ED, p_decision: op } },
      ]);
    }
  },
);

Deno.test('a refusal maps to its status and makes exactly one db call', async () => {
  const { db, calls } = fakeDb({
    data: null,
    error: { code: 'P0001', message: 'ballot not closed' },
  });
  const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op: 'enter' })));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'ballot not closed');
  // the refusal is the END of the call: one rpc, no follow-up write of any kind
  assertEquals(calls.length, 1);
});

Deno.test('every other refusal keeps its message', async () => {
  const cases: [string, number, 'enter' | 'confirm'][] = [
    ['edition not found', 404, 'enter'],
    ['announcement out of phase', 409, 'enter'],
    ['unknown decision', 400, 'confirm'],
    ['decision out of phase', 409, 'confirm'],
    ['no winner declared', 409, 'confirm'],
    ['viability already confirmed', 409, 'confirm'],
  ];
  for (const [message, status, op] of cases) {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message } });
    const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op })));
    assertEquals(res.status, status);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('an unexpected db error is a 502, not a refusal', async () => {
  for (const op of ['enter', 'decline'] as const) {
    const { db } = fakeDb({
      data: null,
      error: { code: '23514', message: 'check constraint violated' },
    });
    const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op })));
    assertEquals(res.status, 502);
  }
});

Deno.test('a null outcome with no error is a 502 (defensive: SQL always returns one)', async () => {
  for (const [op, data] of [
    ['enter', []],
    ['enter', null],
    ['confirm', null],
  ] as [string, RpcResult['data']][]) {
    const { db } = fakeDb({ data, error: null });
    const res = await announceCycle(db, post(JSON.stringify({ editionId: ED, op })));
    assertEquals(res.status, 502);
  }
});
