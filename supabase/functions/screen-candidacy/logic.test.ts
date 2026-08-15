import { assertEquals } from 'jsr:@std/assert@1';
import { screenCandidacy, type ScreenCandidacyDb } from './logic.ts';

// The transaction, the ladder and the criteria validation live in SQL
// (screen_candidacy(), pgTAP 0107). What this layer owes: parse strictly (including the
// reject⇔reasons pairing), call the ONE rpc and nothing else, map each refusal to a
// status, and return the new status untouched.

const CA = '00000000-0000-0000-0000-0000000000ca';

function fakeDb(result: { data: string | null; error: { code?: string; message: string } | null }) {
  const calls: { fn: string; args: unknown }[] = [];
  const db: ScreenCandidacyDb = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { db, calls };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/screen-candidacy', { method: 'POST', body });
}

Deno.test('non-JSON body → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'screening', error: null });
  const res = await screenCandidacy(db, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(calls.length, 0);
});

Deno.test('missing/invalid fields → 400, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'screening', error: null });
  for (const body of [
    '{}',
    '{"candidacyId":"not-a-uuid","decision":"start"}',
    `{"candidacyId":"${CA}","decision":"promote"}`,
    `{"candidacyId":"${CA}"}`,
  ]) {
    const res = await screenCandidacy(db, post(body));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'invalid payload');
  }
  assertEquals(calls.length, 0);
});

Deno.test('reject without reasons → 400 at the edge, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'rejected', error: null });
  for (const body of [
    `{"candidacyId":"${CA}","decision":"reject"}`,
    `{"candidacyId":"${CA}","decision":"reject","reasons":[]}`,
  ]) {
    const res = await screenCandidacy(db, post(body));
    assertEquals(res.status, 400);
  }
  assertEquals(calls.length, 0);
});

Deno.test('reasons on a non-reject decision → 400 at the edge, no db call', async () => {
  const { db, calls } = fakeDb({ data: 'shortlisted', error: null });
  const res = await screenCandidacy(
    db,
    post(`{"candidacyId":"${CA}","decision":"pass","reasons":["plan_coherent"]}`),
  );
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test('a refusal maps to its status and makes exactly one db call', async () => {
  const { db, calls } = fakeDb({
    data: null,
    error: { code: 'P0001', message: 'ballot already open' },
  });
  const res = await screenCandidacy(
    db,
    post(JSON.stringify({ candidacyId: CA, decision: 'pass' })),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'ballot already open');
  // the refusal is the END of the call: one rpc, no follow-up write of any kind
  assertEquals(calls, [
    { fn: 'screen_candidacy', args: { p_candidacy_id: CA, p_decision: 'pass' } },
  ]);
});

Deno.test('every other refusal keeps its message', async () => {
  const cases: [string, number][] = [
    ['candidacy not found', 404],
    ['screening out of phase', 409],
    ['unknown decision', 400],
    ['reasons only on rejection', 400],
    ['rejection requires reasons', 400],
    ['unknown criterion', 400],
    ['invalid transition', 409],
    ['identity not verified', 409],
    ['moderation sanction active', 409],
  ];
  for (const [message, status] of cases) {
    const { db } = fakeDb({ data: null, error: { code: 'P0001', message } });
    const res = await screenCandidacy(
      db,
      post(JSON.stringify({ candidacyId: CA, decision: 'start' })),
    );
    assertEquals(res.status, status);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('an unexpected db error is a 502, not a refusal', async () => {
  const { db } = fakeDb({
    data: null,
    error: { code: '23514', message: 'check constraint violated' },
  });
  const res = await screenCandidacy(
    db,
    post(JSON.stringify({ candidacyId: CA, decision: 'start' })),
  );
  assertEquals(res.status, 502);
});

Deno.test('a reject passes its reasons through and returns the new status', async () => {
  const { db, calls } = fakeDb({ data: 'rejected', error: null });
  const res = await screenCandidacy(
    db,
    post(JSON.stringify({ candidacyId: CA, decision: 'reject', reasons: ['plan_coherent'] })),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { candidacyId: CA, status: 'rejected' });
  assertEquals(calls, [
    {
      fn: 'screen_candidacy',
      args: { p_candidacy_id: CA, p_decision: 'reject', p_reasons: ['plan_coherent'] },
    },
  ]);
});

Deno.test('success returns the new status untouched', async () => {
  const { db, calls } = fakeDb({ data: 'shortlisted', error: null });
  const res = await screenCandidacy(
    db,
    post(JSON.stringify({ candidacyId: CA, decision: 'pass' })),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { candidacyId: CA, status: 'shortlisted' });
  assertEquals(calls.length, 1);
});

Deno.test('a null status with no error is a 502 (defensive: SQL always returns one)', async () => {
  const { db } = fakeDb({ data: null, error: null });
  const res = await screenCandidacy(
    db,
    post(JSON.stringify({ candidacyId: CA, decision: 'start' })),
  );
  assertEquals(res.status, 502);
});
