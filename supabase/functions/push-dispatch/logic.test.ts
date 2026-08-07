// deno test supabase/functions/push-dispatch/ — runs in CI (edge job) and locally.
// Characterization tests for the push pipeline: the two-level preference gate (master
// profiles.push_enabled, then per-type notification_preferences — BOTH default-on when
// the row is absent), locale fallback, token filtering, and per-chunk error swallow.
// All db I/O through injected fakes; Expo SDK bits are recorded closures (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import type { ExpoMessage } from '../_shared/notif-templates.ts';
import { processPushDispatch, type PushDispatchCtx, validatePushBody } from './logic.ts';

const RECIPIENT = 'user-1';

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
};

/** Expo closures: valid tokens start with 'Expo', one chunk per message, one ticket per send. */
const ctx = (
  script: Record<string, FakeResult[]> = {},
  send?: (chunk: ExpoMessage[]) => Promise<unknown[]>,
): Ctx => {
  const db = makeFakeDb(script);
  const sentChunks: ExpoMessage[][] = [];
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
    db,
    sentChunks,
  };
};

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
  assertEquals(b, { sent: 1 });
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
  assertEquals(b, { sent: 0 });
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
  assertEquals(b, { sent: 1 });
  assertEquals(
    c.sentChunks.flat().map((m) => m.to),
    ['ExpoTok[1]'],
  );
});

Deno.test('all tokens invalid → sent 0 without touching Expo', async () => {
  const c = ctx({ ...happyScript(), 'push_tokens.select': [{ data: [{ token: 'bad' }] }] });
  const { body: b } = await run(c);
  assertEquals(b, { sent: 0 });
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
  assertEquals(b, { sent: 1 });
  assertEquals(sent.length, 1);
});
