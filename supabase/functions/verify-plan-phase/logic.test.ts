import { assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb } from '../_shared/fake-db.ts';
import { verifyPlanPhase, type VerifyPlanPhaseDb } from './logic.ts';

// The transition is the database's (public.verify_plan_phase, pgTAP 0117). What is asserted
// here is this layer's whole job: strict parse, ONE rpc with the derived arguments, and the
// refusal → status mapping — every refusal a 4xx that moved nothing, every other error a
// 502 rather than a refusal a caller could mistake for a decision.

const PHASE = '22222222-2222-2222-2222-222222222222';
const STAMP = '2026-08-16T09:00:00.000Z';

function makeDb(result: { data?: unknown; error?: unknown } = { data: STAMP }) {
  const db = makeFakeDb({ 'rpc.verify_plan_phase': [result] });
  return { db: db as unknown as VerifyPlanPhaseDb, calls: db.calls };
}

function post(body: BodyInit): Request {
  return new Request('http://localhost/verify-plan-phase', { method: 'POST', body });
}

const good = () => post(JSON.stringify({ planPhaseId: PHASE, evidence: 'invoice #12, photos' }));

Deno.test('non-JSON body → 400, no rpc', async () => {
  const { db, calls } = makeDb();
  const res = await verifyPlanPhase(db, post('not json'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid json');
  assertEquals(calls.length, 0);
});

Deno.test('malformed payloads → 400, no rpc', async () => {
  for (const body of [
    '{}',
    JSON.stringify({ planPhaseId: 'not-a-uuid', evidence: 'x' }),
    JSON.stringify({ planPhaseId: PHASE }),
    // Evidence is the admin act's substance — an empty or whitespace string is not one.
    JSON.stringify({ planPhaseId: PHASE, evidence: '' }),
    JSON.stringify({ planPhaseId: PHASE, evidence: '   ' }),
    // Bounded here so an oversized string never travels to the database at all.
    JSON.stringify({ planPhaseId: PHASE, evidence: 'x'.repeat(1001) }),
    JSON.stringify({ planPhaseId: PHASE, evidence: 'x', extra: true }), // strict shape
  ]) {
    const { db, calls } = makeDb();
    const res = await verifyPlanPhase(db, post(body));
    assertEquals(res.status, 400, body);
    assertEquals((await res.json()).error, 'invalid payload');
    assertEquals(calls.length, 0, body);
  }
});

Deno.test('the happy path: one rpc, the stamp echoed back', async () => {
  const { db, calls } = makeDb();
  const res = await verifyPlanPhase(db, good());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { planPhaseId: PHASE, verifiedAt: STAMP });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].columns, 'verify_plan_phase');
  assertEquals(calls[0].values, { p_phase_id: PHASE, p_evidence: 'invoice #12, photos' });
});

Deno.test('evidence is trimmed before it reaches the transition', async () => {
  const { db, calls } = makeDb();
  await verifyPlanPhase(db, post(JSON.stringify({ planPhaseId: PHASE, evidence: '  done  ' })));
  assertEquals(calls[0].values, { p_phase_id: PHASE, p_evidence: 'done' });
});

Deno.test('each P0001 refusal maps to its own status', async () => {
  for (const [message, status] of [
    ['plan phase not found', 404],
    ['plan not found', 404],
    ['edition not found', 404],
    ['plan not published', 409],
    ['verification out of phase', 409],
    ['phase already verified', 409],
    ['evidence required', 400],
    ['evidence too long', 400],
  ] as const) {
    const { db } = makeDb({ error: { code: 'P0001', message } });
    const res = await verifyPlanPhase(db, good());
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, message);
  }
});

Deno.test('anything outside the refusal table is a failure, not a decision — 502', async () => {
  for (const dbErr of [
    { code: '42501', message: 'permission denied' },
    { code: 'P0001', message: 'some refusal this layer does not know' },
    { message: 'connection reset' },
  ]) {
    const { db } = makeDb({ error: dbErr });
    const res = await verifyPlanPhase(db, good());
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error, 'verification failed');
  }
});

Deno.test('a transition that returns no stamp is a failure, never a silent success', async () => {
  // The UI-affirms-a-write-that-never-happened failure mode: a 200 with no verifiedAt
  // would tell an operator the gate is open when nothing was recorded.
  const { db } = makeDb({ data: null });
  const res = await verifyPlanPhase(db, good());
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, 'verification returned no timestamp');
});
