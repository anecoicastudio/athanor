// deno test supabase/functions/notification-fan-out/ — runs in CI (edge job) and locally.
// Characterization tests for the fan-out: sole-writer insert, best-effort push (a failed
// invoke never fails the request), and the entity_ref object→string payload transform.
// All db I/O through injected fakes (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { type FanOutCtx, processFanOut } from './logic.ts';

const RECIPIENT = 'user-1';

const body = (over: Record<string, unknown> = {}) => ({
  recipient_id: RECIPIENT,
  type: 'moment',
  template_key: 'notif.tpl.moment',
  params: { name: 'aurora' },
  entity_ref: { kind: 'moment', id: 'm-1' },
  ...over,
});

type Ctx = FanOutCtx & { db: FakeDb; pushed: Record<string, unknown>[] };

const ctx = (
  script: Record<string, FakeResult[]> = {},
  invokePush?: FanOutCtx['invokePush'],
): Ctx => {
  const db = makeFakeDb(script);
  const pushed: Record<string, unknown>[] = [];
  return {
    admin: db as unknown as FanOutCtx['admin'],
    invokePush:
      invokePush ??
      ((payload) => {
        pushed.push(payload);
        return Promise.resolve();
      }),
    db,
    pushed,
  };
};

const run = async (c: Ctx, raw: unknown = body()) => {
  const res = await processFanOut(c, raw);
  return { res, body: await res.json() };
};

Deno.test('missing/blank required field → 400, nothing written or pushed', async () => {
  for (const bad of [
    null,
    {},
    body({ recipient_id: '' }),
    body({ type: '  ' }),
    body({ template_key: 7 }),
  ]) {
    const c = ctx();
    const { res, body: b } = await run(c, bad);
    assertEquals(res.status, 400);
    assertEquals(b, { error: 'missing fields' });
    assertEquals(c.db.calls.length, 0);
    assertEquals(c.pushed.length, 0);
  }
});

Deno.test('insert error → 500 with the pg message; push never invoked', async () => {
  const c = ctx({ 'notifications.insert': [{ error: { message: 'boom' } }] });
  const { res, body: b } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(b, { error: 'notification insert failed: boom' });
  assertEquals(c.pushed.length, 0);
});

Deno.test(
  'happy path → notification row + push payload; entity_ref crosses JSON-stringified',
  async () => {
    const c = ctx();
    const { res, body: b } = await run(c);
    assertEquals(res.status, 200);
    assertEquals(b, { ok: true });

    // the in-app row keeps entity_ref as an OBJECT…
    const ins = c.db.calls.find((call) => call.table === 'notifications');
    assert(ins);
    assertEquals(ins.op, 'insert');
    assertEquals(ins.values, {
      recipient_id: RECIPIENT,
      type: 'moment',
      template_key: 'notif.tpl.moment',
      params: { name: 'aurora' },
      entity_ref: { kind: 'moment', id: 'm-1' },
    });

    // …while the push-dispatch payload carries it as a STRING (its body contract).
    assertEquals(c.pushed, [
      {
        recipient_id: RECIPIENT,
        type: 'moment',
        template_key: 'notif.tpl.moment',
        params: { name: 'aurora' },
        entity_ref: '{"kind":"moment","id":"m-1"}',
      },
    ]);
  },
);

Deno.test('absent params/entity_ref default to {} / null (row) and "{}" (push)', async () => {
  const c = ctx();
  await run(c, body({ params: undefined, entity_ref: undefined }));
  const ins = c.db.calls.find((call) => call.table === 'notifications');
  assert(ins);
  assertEquals((ins.values as { params: unknown }).params, {});
  assertEquals((ins.values as { entity_ref: unknown }).entity_ref, null);
  assertEquals(c.pushed[0].params, {});
  assertEquals(c.pushed[0].entity_ref, '{}');
});

Deno.test('push-dispatch failure is swallowed — the row is written, still 200 ok', async () => {
  const c = ctx({}, () => Promise.reject(new Error('push down')));
  const { res, body: b } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(b, { ok: true });
  assert(c.db.calls.some((call) => call.table === 'notifications' && call.op === 'insert'));
});
