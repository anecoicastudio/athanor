// deno test supabase/functions/check-in/ — runs in CI (edge job) and locally.
// Characterization tests for the check-in verdict ladder. Real HMAC tokens via
// signQrToken + a fixed test secret; all db I/O through injected fakes (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { signQrToken } from '../_shared/qr.ts';
import { type CheckInCtx, processCheckIn } from './logic.ts';

const SECRET = 'test-qr-secret';
const EVENT = 'evt-1';
const ORGANIZER = 'org-1';
const HOLDER = 'holder-1';

const token = (eid = EVENT, uid = HOLDER) => signQrToken({ eid, uid, iat: 1751000000 }, SECRET);

const ctx = (
  adminScript: Record<string, FakeResult[]> = {},
  userScript: Record<string, FakeResult[]> = {},
): CheckInCtx & { adminDb: FakeDb; userDb: FakeDb } => {
  const adminDb = makeFakeDb(adminScript);
  const userDb = makeFakeDb(userScript);
  return {
    admin: adminDb as unknown as CheckInCtx['admin'],
    userClient: userDb as unknown as CheckInCtx['userClient'],
    qrSecret: SECRET,
    adminDb,
    userDb,
  };
};

/** Admin script for the common path: event owned by ORGANIZER + a ticket + holder handle. */
const happyAdmin = (ticketStatus = 'paid'): Record<string, FakeResult[]> => ({
  'events.select': [{ data: { id: EVENT, organizer_id: ORGANIZER } }],
  'event_tickets.select': [{ data: { id: 'tick-1', status: ticketStatus } }],
  'profiles.select': [{ data: { handle: 'aurora' } }],
});

const run = async (c: CheckInCtx, qrToken: string, eventId = EVENT, scannerId = ORGANIZER) => {
  const res = await processCheckIn(c, { scannerId, eventId, qrToken });
  return { res, body: await res.json() };
};

// ── gates 1-2: token ─────────────────────────────────────────────────────────

Deno.test('forged/malformed token → invalid, no db touched', async () => {
  const c = ctx();
  const { res, body } = await run(c, 'not-a-token');
  assertEquals(res.status, 200); // every scan verdict is a 200
  assertEquals(body, { result: 'invalid' });
  assertEquals(c.adminDb.calls.length, 0);
  assertEquals(c.userDb.calls.length, 0);
});

Deno.test('token signed with a different secret → invalid', async () => {
  const c = ctx();
  const foreign = await signQrToken({ eid: EVENT, uid: HOLDER, iat: 1 }, 'other-secret');
  const { body } = await run(c, foreign);
  assertEquals(body, { result: 'invalid' });
});

Deno.test('token for another event → wrongEvent before any lookup', async () => {
  const c = ctx();
  const { body } = await run(c, await token('evt-OTHER'));
  assertEquals(body, { result: 'wrongEvent' });
  assertEquals(c.adminDb.calls.length, 0);
});

// ── gate 3: organizer ────────────────────────────────────────────────────────

Deno.test('event lookup error → 500; missing event → 404', async () => {
  const err = ctx({ 'events.select': [{ error: { message: 'boom' } }] });
  assertEquals((await run(err, await token())).res.status, 500);

  const missing = ctx({ 'events.select': [{ data: null }] });
  assertEquals((await run(missing, await token())).res.status, 404);
});

Deno.test('scanner is not the organizer → 403, ticket never read', async () => {
  const c = ctx({ 'events.select': [{ data: { id: EVENT, organizer_id: 'someone-else' } }] });
  const { res } = await run(c, await token());
  assertEquals(res.status, 403);
  assert(!c.adminDb.calls.some((call) => call.table === 'event_tickets'));
});

// ── gate 4: ticket status ────────────────────────────────────────────────────

Deno.test('no ticket / pending / refunded → invalid', async () => {
  for (const scripted of [
    { data: null },
    { data: { id: 't', status: 'pending' } },
    { data: { id: 't', status: 'refunded' } },
  ]) {
    const c = ctx({
      'events.select': [{ data: { id: EVENT, organizer_id: ORGANIZER } }],
      'event_tickets.select': [scripted],
    });
    const { body } = await run(c, await token());
    assertEquals(body, { result: 'invalid' });
    assertEquals(c.userDb.calls.length, 0); // never attempts the attendance write
  }
});

Deno.test('already checked-in ticket → already + holder name, no write attempted', async () => {
  const c = ctx(happyAdmin('checked_in'));
  const { body } = await run(c, await token());
  assertEquals(body, { result: 'already', name: 'aurora' });
  assertEquals(c.userDb.calls.length, 0);
  assert(!c.adminDb.calls.some((call) => call.op === 'update'));
});

// ── write path ───────────────────────────────────────────────────────────────

Deno.test('paid ticket happy path → valid; RLS-gated insert + service-role flip', async () => {
  const c = ctx(happyAdmin(), { 'event_attendance.upsert': [{ data: [{ id: 'att-1' }] }] });
  const { body } = await run(c, await token());
  assertEquals(body, { result: 'valid', name: 'aurora' });

  // attendance is written on the CALLER's client (RLS organizer WITH CHECK = 2nd gate)…
  const ins = c.userDb.calls.find((call) => call.table === 'event_attendance');
  assert(ins);
  assertEquals(ins.op, 'upsert');
  assertEquals(ins.options, { onConflict: 'ticket_id', ignoreDuplicates: true });
  assertEquals(ins.values, { ticket_id: 'tick-1', event_id: EVENT, scanned_by: ORGANIZER });

  // …and the money flip runs as SERVICE ROLE, guarded on status='paid' (idempotent).
  const flip = c.adminDb.calls.find(
    (call) => call.table === 'event_tickets' && call.op === 'update',
  );
  assert(flip);
  assertEquals(flip.values, { status: 'checked_in' });
  assert(flip.filters.some(([f, col, v]) => f === 'eq' && col === 'status' && v === 'paid'));
});

Deno.test('concurrent double-scan (0 rows inserted) → already', async () => {
  const c = ctx(happyAdmin(), { 'event_attendance.upsert': [{ data: [] }] });
  const { body } = await run(c, await token());
  assertEquals(body, { result: 'already', name: 'aurora' });
});

Deno.test('attendance insert RLS-denied (42501) → 403; other insert error → 500', async () => {
  const denied = ctx(happyAdmin(), {
    'event_attendance.upsert': [{ error: { code: '42501' } }],
  });
  assertEquals((await run(denied, await token())).res.status, 403);

  const broken = ctx(happyAdmin(), {
    'event_attendance.upsert': [{ error: { code: 'XX000' } }],
  });
  assertEquals((await run(broken, await token())).res.status, 500);
});

Deno.test(
  'flip failure is best-effort — scan still returns valid (attendance is the truth)',
  async () => {
    const c = ctx(
      { ...happyAdmin(), 'event_tickets.update': [{ error: { message: 'flip down' } }] },
      { 'event_attendance.upsert': [{ data: [{ id: 'att-1' }] }] },
    );
    const { res, body } = await run(c, await token());
    assertEquals(res.status, 200);
    assertEquals(body, { result: 'valid', name: 'aurora' });
  },
);
