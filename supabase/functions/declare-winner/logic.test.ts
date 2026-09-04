import { assertEquals } from 'jsr:@std/assert@1';
import { declareWinner, type DeclareWinnerDb, type TallyRow } from './logic.ts';

// The transaction, the refusals and the tie order live in SQL (declare_winner(),
// pgTAP 0103). What this layer owes: parse strictly, call the ONE rpc and nothing
// else, map each refusal to a status, and pass the ballot ordering through untouched.

const ED = '00000000-0000-0000-0000-0000000000ed';
const C1 = '00000000-0000-0000-0000-0000000000c1';
const C2 = '00000000-0000-0000-0000-0000000000c2';

const TALLY: TallyRow[] = [
  { candidacy_id: C1, vote_count: 2, weighted_total: 0, is_winner: true },
  { candidacy_id: C2, vote_count: 2, weighted_total: 0, is_winner: false },
];

function fakeDb(result: {
  data: TallyRow[] | null;
  error: { code?: string; message: string } | null;
}) {
  const calls: { fn: string; args: unknown }[] = [];
  const db: DeclareWinnerDb = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { db, calls };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/declare-winner', { method: 'POST', body });
}

Deno.test('non-JSON body → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: TALLY, error: null });
  const res = await declareWinner(db, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(calls.length, 0);
});

Deno.test('missing/invalid editionId → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: TALLY, error: null });
  for (const body of ['{}', '{"editionId":"not-a-uuid"}', '{"editionId":42}']) {
    const res = await declareWinner(db, post(body));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'invalid payload');
  }
  assertEquals(calls.length, 0);
});

Deno.test('below-min_voters refusal maps to 409 and makes exactly one db call', async () => {
  const { db, calls } = fakeDb({ data: null, error: { code: 'P0001', message: 'quorum not met' } });
  const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'quorum not met');
  // the refusal is the END of the call: one rpc, no follow-up write of any kind
  assertEquals(calls, [{ fn: 'declare_winner', args: { p_edition_id: ED } }]);
});

Deno.test('below-min_funding_cents refusal maps to 409 and makes exactly one db call', async () => {
  const { db, calls } = fakeDb({
    data: null,
    error: { code: 'P0001', message: 'funding floor not met' },
  });
  const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'funding floor not met');
  assertEquals(calls, [{ fn: 'declare_winner', args: { p_edition_id: ED } }]);
});

Deno.test('every other refusal keeps its message', async () => {
  const cases: [string, number][] = [
    ['edition not found', 404],
    ['winner already declared', 409],
    ['declaration out of phase', 409],
    ['ballot not closed', 409],
    ['no votable candidacy', 409],
  ];
  for (const [message, status] of cases) {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message } });
    const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
    assertEquals(res.status, status);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('an unexpected db error is a 502, not a refusal', async () => {
  const { db } = fakeDb({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });
  const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
  assertEquals(res.status, 502);
});

Deno.test('success returns the winner and the full ballot ordering, untouched', async () => {
  const { db, calls } = fakeDb({ data: TALLY, error: null });
  const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.winnerCandidacyId, C1);
  assertEquals(body.results, TALLY); // order preserved — FUND-38's «risultati» come from this
  assertEquals(calls.length, 1);
});

Deno.test(
  'a result set with no winner row is a 502 (defensive: SQL always flags one)',
  async () => {
    const { db } = fakeDb({
      data: [{ candidacy_id: C1, vote_count: 2, weighted_total: 0, is_winner: false }],
      error: null,
    });
    const res = await declareWinner(db, post(JSON.stringify({ editionId: ED })));
    assertEquals(res.status, 502);
  },
);
