// deno test supabase/functions/push-dispatch/ — runs in CI (edge job) and locally.
// Characterization tests for the push pipeline: the two-level preference gate (master
// profiles.push_enabled, then per-type notification_preferences — BOTH default-on when
// the row is absent), locale fallback, token filtering, per-chunk error swallow, and the
// receipt sweep that prunes DeviceNotRegistered tokens (#128).
// All db I/O through injected fakes; Expo SDK bits are recorded closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import type { ExpoMessage } from '../_shared/notif-templates.ts';
import {
  processPushDispatch,
  type PushDispatchCtx,
  RECEIPT_READY_AFTER_MS,
  RECEIPT_TTL_MS,
  SWEEP_BATCH,
  validatePushBody,
} from './logic.ts';

const RECIPIENT = 'user-1';
/** Pinned clock — the sweep's window math is asserted against it, never against the wall. */
const NOW = new Date('2026-08-12T12:00:00.000Z');

const body = (over: Record<string, unknown> = {}) => ({
  recipient_id: RECIPIENT,
  type: 'message',
  template_key: 'notif.tpl.message',
  params: { name: 'aurora', preview: 'ciao' },
  entity_ref: 'chat-1',
  ...over,
});

type Ctx = PushDispatchCtx & {
  db: FakeDb;
  sentChunks: ExpoMessage[][];
  receiptCalls: string[][];
};

/** Expo closures: valid tokens start with 'Expo', one chunk per message, one ticket per send. */
const ctx = (
  script: Record<string, FakeResult[]> = {},
  send?: (chunk: ExpoMessage[]) => Promise<unknown[]>,
  getReceipts?: (ids: string[]) => Promise<Record<string, unknown>>,
): Ctx => {
  const db = makeFakeDb(script);
  const sentChunks: ExpoMessage[][] = [];
  const receiptCalls: string[][] = [];
  return {
    admin: db as unknown as PushDispatchCtx['admin'],
    isExpoPushToken: (t) => t.startsWith('Expo'),
    chunk: (messages) => messages.map((m) => [m]),
    send:
      send ??
      ((chunk) => {
        sentChunks.push(chunk);
        return Promise.resolve(chunk.map(() => ({ status: 'ok' })));
      }),
    chunkReceiptIds: (ids) => {
      receiptCalls.push(ids);
      return [ids];
    },
    getReceipts: getReceipts ?? (() => Promise.resolve({})),
    now: () => NOW,
    db,
    sentChunks,
    receiptCalls,
  };
};

const callsTo = (c: Ctx, table: string, op: string) =>
  c.db.calls.filter((call) => call.table === table && call.op === op);

/** Gate rows absent (default-on) + one valid token; 'profiles.select' is FIFO: gate, then locale. */
const happyScript = (locale: unknown = 'it'): Record<string, FakeResult[]> => ({
  'profiles.select': [{ data: null }, { data: { locale } }],
  'notification_preferences.select': [{ data: null }],
  'push_tokens.select': [{ data: [{ token: 'ExpoTok[1]' }] }],
});

const run = async (c: Ctx, raw: unknown = body()) => {
  const res = await processPushDispatch(c, raw);
  return { res, body: await res.json() };
};

// ── validation ───────────────────────────────────────────────────────────────

Deno.test('missing/blank required field → 400, no db touched', async () => {
  for (const bad of [
    null,
    {},
    body({ recipient_id: '' }),
    body({ type: '  ' }),
    body({ template_key: undefined }),
    body({ entity_ref: 42 }),
  ]) {
    const c = ctx();
    const { res, body: b } = await run(c, bad);
    assertEquals(res.status, 400);
    assertEquals(b, { error: 'missing fields' });
    assertEquals(c.db.calls.length, 0);
  }
  // params is optional — validator accepts a body without it.
  assert(validatePushBody(body({ params: undefined })));
});

// ── the two-level preference gate ────────────────────────────────────────────

Deno.test('master push_enabled=false → master_push_off, nothing sent', async () => {
  const c = ctx({ 'profiles.select': [{ data: { push_enabled: false } }] });
  const { res, body: b } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(b, { sent: 0, skipped: 'master_push_off' });
  assertEquals(c.sentChunks.length, 0);
  // gate never reaches the token lookup
  assert(!c.db.calls.some((call) => call.table === 'push_tokens'));
});

Deno.test('per-type pref enabled=false → type_pref_off, nothing sent', async () => {
  const c = ctx({
    'profiles.select': [{ data: { push_enabled: true } }],
    'notification_preferences.select': [{ data: { enabled: false } }],
  });
  const { body: b } = await run(c);
  assertEquals(b, { sent: 0, skipped: 'type_pref_off' });
  assertEquals(c.sentChunks.length, 0);
});

Deno.test('absent gate rows = default-on (master rule, 09 §2.5) → sends', async () => {
  const c = ctx(happyScript());
  const { body: b } = await run(c);
  assertEquals(b, { sent: 1, failed: 0, pruned: 0 });
  assertEquals(c.sentChunks.length, 1);

  // the per-type gate row is looked up by (profile, type, channel='push')
  const pref = c.db.calls.find((call) => call.table === 'notification_preferences');
  assert(pref);
  assertEquals(pref.filters, [
    ['eq', 'profile_id', RECIPIENT],
    ['eq', 'type', 'message'],
    ['eq', 'channel', 'push'],
  ]);
});

Deno.test('no registered tokens → sent 0, send never called', async () => {
  const c = ctx({ ...happyScript(), 'push_tokens.select': [{ data: [] }] });
  const { body: b } = await run(c);
  assertEquals(b, { sent: 0, failed: 0, pruned: 0 });
  assertEquals(c.sentChunks.length, 0);
});

// ── locale ───────────────────────────────────────────────────────────────────

Deno.test("locale 'en' → english copy; anything else falls back to 'it'", async () => {
  const en = ctx(happyScript('en'));
  await run(en);
  assertEquals(en.sentChunks[0][0].title, 'New message');

  for (const other of ['de', null, undefined]) {
    const it = ctx(happyScript(other));
    await run(it);
    assertEquals(it.sentChunks[0][0].title, 'Nuovo messaggio');
  }
});

// ── token filtering + chunked send ───────────────────────────────────────────

Deno.test('non-Expo tokens are filtered out before send', async () => {
  const c = ctx({
    ...happyScript(),
    'push_tokens.select': [{ data: [{ token: 'ExpoTok[1]' }, { token: 'apns-raw' }] }],
  });
  const { body: b } = await run(c);
  assertEquals(b, { sent: 1, failed: 0, pruned: 0 });
  assertEquals(
    c.sentChunks.flat().map((m) => m.to),
    ['ExpoTok[1]'],
  );
});

Deno.test('all tokens invalid → sent 0 without touching Expo', async () => {
  const c = ctx({ ...happyScript(), 'push_tokens.select': [{ data: [{ token: 'bad' }] }] });
  const { body: b } = await run(c);
  assertEquals(b, { sent: 0, failed: 0, pruned: 0 });
  assertEquals(c.sentChunks.length, 0);
});

Deno.test('a failing chunk is swallowed — the others still send, count reflects them', async () => {
  const sent: ExpoMessage[][] = [];
  let n = 0;
  const c = ctx(
    {
      ...happyScript(),
      'push_tokens.select': [{ data: [{ token: 'ExpoTok[1]' }, { token: 'ExpoTok[2]' }] }],
    },
    (chunk) => {
      if (n++ === 0) return Promise.reject(new Error('expo down'));
      sent.push(chunk);
      return Promise.resolve(chunk.map(() => ({ status: 'ok' })));
    },
  );
  const { res, body: b } = await run(c);
  assertEquals(res.status, 200); // per-chunk failure never fails the request
  // the dead chunk's message counts as failed — a swallowed exception is not zero failures (#128)
  assertEquals(b, { sent: 1, failed: 1, pruned: 0 });
  assertEquals(sent.length, 1);
});

// ── per-ticket verdicts (#128) ───────────────────────────────────────────────

Deno.test('an error ticket is NOT counted as sent', async () => {
  const c = ctx({ ...happyScript() }, (chunk) =>
    Promise.resolve(chunk.map(() => ({ status: 'error', message: 'boom' }))),
  );
  const { body: b } = await run(c);
  assertEquals(b, { sent: 0, failed: 1, pruned: 0 });
});

Deno.test('DeviceNotRegistered on the ticket prunes the token immediately', async () => {
  const c = ctx(
    {
      ...happyScript(),
      'push_tokens.select': [{ data: [{ token: 'ExpoTok[1]' }, { token: 'ExpoTok[2]' }] }],
    },
    (chunk) =>
      Promise.resolve(
        chunk.map((m) =>
          m.to === 'ExpoTok[2]'
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: 'r-1' },
        ),
      ),
  );
  const { body: b } = await run(c);
  assertEquals(b, { sent: 1, failed: 1, pruned: 1 });

  const del = callsTo(c, 'push_tokens', 'delete');
  assertEquals(del.length, 1);
  assertEquals(del[0].filters, [['in', 'token', ['ExpoTok[2]']]]);
});

Deno.test('an ok ticket stores its receipt id for the sweep', async () => {
  const c = ctx({ ...happyScript() }, (chunk) =>
    Promise.resolve(chunk.map(() => ({ status: 'ok', id: 'receipt-abc' }))),
  );
  await run(c);
  const stored = callsTo(c, 'push_receipts', 'upsert');
  assertEquals(stored.length, 1);
  assertEquals(stored[0].values, [
    { receipt_id: 'receipt-abc', token: 'ExpoTok[1]', profile_id: RECIPIENT },
  ]);
  assertEquals(stored[0].options, { onConflict: 'receipt_id', ignoreDuplicates: true });
});

Deno.test('an ok ticket without an id sends but stores nothing', async () => {
  const c = ctx(happyScript()); // default send returns { status: 'ok' }, no id
  const { body: b } = await run(c);
  assertEquals(b, { sent: 1, failed: 0, pruned: 0 });
  assertEquals(callsTo(c, 'push_receipts', 'upsert').length, 0);
});

// ── receipt sweep (#128) ─────────────────────────────────────────────────────

const sweep = { mode: 'sweep' };
const pendingRows = (rows: { receipt_id: string; token: string }[]) => ({
  'push_receipts.select': [{ data: rows }],
});

Deno.test('sweep with nothing pending → zeroes, Expo never called', async () => {
  const c = ctx(pendingRows([]));
  const { body: b } = await run(c, sweep);
  assertEquals(b, { checked: 0, failed: 0, pruned: 0 });
  assertEquals(c.receiptCalls.length, 0);
});

Deno.test('sweep reads only tickets old enough to have a receipt, oldest first', async () => {
  const c = ctx(pendingRows([{ receipt_id: 'r-1', token: 'ExpoTok[1]' }]));
  await run(c, sweep);

  const read = callsTo(c, 'push_receipts', 'select')[0];
  assertEquals(read.filters, [
    ['lt', 'created_at', new Date(NOW.getTime() - RECEIPT_READY_AFTER_MS).toISOString()],
  ]);
  assertEquals(read.modifiers, [
    ['order', 'created_at', { ascending: true }],
    ['limit', SWEEP_BATCH],
  ]);
});

Deno.test('sweep drops rows Expo can no longer answer for, before taking a batch', async () => {
  const c = ctx(pendingRows([]));
  await run(c, sweep);

  const expire = callsTo(c, 'push_receipts', 'delete')[0];
  assert(expire);
  assertEquals(expire.filters, [
    ['lt', 'created_at', new Date(NOW.getTime() - RECEIPT_TTL_MS).toISOString()],
  ]);
  // and it runs ahead of the batch read
  const order = c.db.calls.filter((call) => call.table === 'push_receipts').map((call) => call.op);
  assertEquals(order[0], 'delete');
  assertEquals(order[1], 'select');
});

Deno.test('DeviceNotRegistered in a receipt prunes the token and drains the row', async () => {
  const c = ctx(
    pendingRows([
      { receipt_id: 'r-ok', token: 'ExpoTok[1]' },
      { receipt_id: 'r-dead', token: 'ExpoTok[2]' },
    ]),
    undefined,
    () =>
      Promise.resolve({
        'r-ok': { status: 'ok' },
        'r-dead': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      }),
  );
  const { body: b } = await run(c, sweep);
  assertEquals(b, { checked: 2, failed: 1, pruned: 1 });

  assertEquals(callsTo(c, 'push_tokens', 'delete')[0].filters, [['in', 'token', ['ExpoTok[2]']]]);
  // both resolved ids are drained — the healthy one too, it has nothing left to say
  const drain = callsTo(c, 'push_receipts', 'delete')[1];
  assertEquals(drain.filters, [['in', 'receipt_id', ['r-ok', 'r-dead']]]);
});

Deno.test('a non-DeviceNotRegistered receipt error counts but keeps the token', async () => {
  const c = ctx(pendingRows([{ receipt_id: 'r-1', token: 'ExpoTok[1]' }]), undefined, () =>
    Promise.resolve({ 'r-1': { status: 'error', details: { error: 'MessageRateExceeded' } } }),
  );
  const { body: b } = await run(c, sweep);
  assertEquals(b, { checked: 1, failed: 1, pruned: 0 });
  assertEquals(callsTo(c, 'push_tokens', 'delete').length, 0);
});

Deno.test('an id Expo has no receipt for yet is left in place for the next run', async () => {
  const c = ctx(
    pendingRows([
      { receipt_id: 'r-ready', token: 'ExpoTok[1]' },
      { receipt_id: 'r-pending', token: 'ExpoTok[2]' },
    ]),
    undefined,
    () => Promise.resolve({ 'r-ready': { status: 'ok' } }), // absent = not ready
  );
  const { body: b } = await run(c, sweep);
  assertEquals(b, { checked: 1, failed: 0, pruned: 0 });
  assertEquals(callsTo(c, 'push_receipts', 'delete')[1].filters, [
    ['in', 'receipt_id', ['r-ready']],
  ]);
});

Deno.test('the receipt token wins over the stored one when Expo names it', async () => {
  const c = ctx(pendingRows([{ receipt_id: 'r-1', token: 'ExpoStale[1]' }]), undefined, () =>
    Promise.resolve({
      'r-1': {
        status: 'error',
        details: { error: 'DeviceNotRegistered', expoPushToken: 'ExpoReal[1]' },
      },
    }),
  );
  await run(c, sweep);
  assertEquals(callsTo(c, 'push_tokens', 'delete')[0].filters, [['in', 'token', ['ExpoReal[1]']]]);
});

Deno.test('a failing receipt fetch leaves the rows alone', async () => {
  const c = ctx(pendingRows([{ receipt_id: 'r-1', token: 'ExpoTok[1]' }]), undefined, () =>
    Promise.reject(new Error('expo down')),
  );
  const { res, body: b } = await run(c, sweep);
  assertEquals(res.status, 200);
  assertEquals(b, { checked: 0, failed: 0, pruned: 0 });
  assertEquals(callsTo(c, 'push_receipts', 'delete').length, 1); // the TTL drop only
});

Deno.test('sweep surfaces a read failure instead of reporting a clean zero', async () => {
  const c = ctx({ 'push_receipts.select': [{ error: { message: 'nope' } }] });
  const { res, body: b } = await run(c, sweep);
  assertEquals(res.status, 500);
  assertEquals(b, { error: 'receipt read failed' });
});

// ── mode routing ─────────────────────────────────────────────────────────────

Deno.test('an absent mode still means send (enqueue_push posts a bare body)', async () => {
  const c = ctx(happyScript());
  const { body: b } = await run(c);
  assertEquals(b, { sent: 1, failed: 0, pruned: 0 });
});

Deno.test("mode 'send' is accepted explicitly", async () => {
  const c = ctx(happyScript());
  const { body: b } = await run(c, body({ mode: 'send' }));
  assertEquals(b, { sent: 1, failed: 0, pruned: 0 });
});

Deno.test('an unknown mode → 400, no db touched', async () => {
  const c = ctx();
  const { res, body: b } = await run(c, { mode: 'drain' });
  assertEquals(res.status, 400);
  assertEquals(b, { error: 'unknown mode' });
  assertEquals(c.db.calls.length, 0);
});
