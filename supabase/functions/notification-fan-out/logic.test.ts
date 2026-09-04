// deno test supabase/functions/notification-fan-out/ — runs in CI (edge job) and locally.
// Characterization tests for the fan-out: sole-writer insert, best-effort push (a failed
// invoke never fails the request), and the entity_ref object→string payload transform.
// All db I/O through injected fakes (DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { AUDIENCE_PAGE, type FanOutCtx, processFanOut } from './logic.ts';

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

// The single path upserts and reads back what it actually wrote (#521), so its tests have to say
// whether the row was new. `wrote` = a fresh insert; `conflicted` = a retry that hit the key.
const wrote = { data: [{ id: 'n-1' }] };
const conflicted = { data: [] };

Deno.test('missing/blank required field → 400, nothing written or pushed', async () => {
  for (const bad of [
    null,
    {},
    body({ recipient_id: '' }),
    body({ type: '  ' }),
    body({ template_key: 7 }),
    // present but malformed: dropping it and writing an unkeyed row would make the reconciler's
    // retry deliver the notification twice (#521), so it fails closed instead.
    body({ dedupe_key: '   ' }),
    body({ dedupe_key: 42 }),
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
  // 500 and not 200: an insert failure is the one class the reconciler MUST retry, because the
  // in-app row does not exist. A push failure is the 200 below, for the opposite reason.
  const c = ctx({ 'notifications.upsert': [{ error: { message: 'boom' } }] });
  const { res, body: b } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(b, { error: 'notification insert failed: boom' });
  assertEquals(c.pushed.length, 0);
});

Deno.test(
  'happy path → notification row + push payload; entity_ref crosses JSON-stringified',
  async () => {
    const c = ctx({ 'notifications.upsert': [wrote] });
    const { res, body: b } = await run(c);
    assertEquals(res.status, 200);
    assertEquals(b, { ok: true, pushed: true });

    // the in-app row keeps entity_ref as an OBJECT…
    const ins = c.db.calls.find((call) => call.table === 'notifications');
    assert(ins);
    assertEquals(ins.op, 'upsert');
    // …on the same conflict target the broadcast path uses, so the reconciler's re-POST of the
    // stored body cannot write the row twice (#521).
    assertEquals(ins.options, { onConflict: 'recipient_id,dedupe_key', ignoreDuplicates: true });
    assertEquals(ins.values, {
      recipient_id: RECIPIENT,
      type: 'moment',
      template_key: 'notif.tpl.moment',
      params: { name: 'aurora' },
      entity_ref: { kind: 'moment', id: 'm-1' },
      dedupe_key: null,
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
  const c = ctx({ 'notifications.upsert': [wrote] });
  await run(c, body({ params: undefined, entity_ref: undefined }));
  const ins = c.db.calls.find((call) => call.table === 'notifications');
  assert(ins);
  assertEquals((ins.values as { params: unknown }).params, {});
  assertEquals((ins.values as { entity_ref: unknown }).entity_ref, null);
  assertEquals(c.pushed[0].params, {});
  assertEquals(c.pushed[0].entity_ref, '{}');
});

Deno.test('push-dispatch failure is swallowed — the row is written, still 200 ok', async () => {
  // Still 200, and now SAYING so: #521 asks fan-out to surface the failure class, and the
  // distinction is load-bearing for the reconciler. A lost push must not re-run an insert that
  // already succeeded — that is push-dispatch's receipt sweep, not this one's business.
  const c = ctx({ 'notifications.upsert': [wrote] }, () => Promise.reject(new Error('push down')));
  const { res, body: b } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, pushed: false });
  assert(c.db.calls.some((call) => call.table === 'notifications' && call.op === 'upsert'));
});

// ── single-path idempotency (#521) ───────────────────────────────────────────────────────────
// athanor.enqueue_notification mints a dedupe_key per dispatch and stores the body it POSTed, so
// athanor.notification_dispatch_reconcile() can re-POST that exact body after a 5xx. These two
// tests are the reason that is safe.

Deno.test('a dedupe_key crosses into the row so the reconciler can re-POST it', async () => {
  const c = ctx({ 'notifications.upsert': [wrote] });
  const { res, body: b } = await run(c, body({ dedupe_key: 'd-1' }));
  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, pushed: true });
  const ins = c.db.calls.find((call) => call.table === 'notifications');
  assertEquals((ins?.values as { dedupe_key?: string }).dedupe_key, 'd-1');
  assertEquals(c.pushed.length, 1, 'a first delivery still pushes');
});

Deno.test('a retry of the same dispatch writes nothing and pushes nobody', async () => {
  // RETURNING comes back empty because the key conflicted: the first attempt already delivered
  // it. Pushing here would be the double «Hai un Momento» the key exists to prevent, and a
  // non-2xx here would make the reconciler retry forever.
  const c = ctx({ 'notifications.upsert': [conflicted] });
  const { res, body: b } = await run(c, body({ dedupe_key: 'd-1' }));
  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, deduped: true });
  assertEquals(c.pushed.length, 0);
});

// ── audience mode (#127) ─────────────────────────────────────────────────────────────────
// The broadcast shape: one bulk insert per page of eligible members, then a push to the
// recipients whose row was actually INSERTED. The two properties that matter are (a) the
// insert is `on conflict do nothing` so a re-send is safe (#521), and (b) the push follows the
// insert's RETURNING rather than the intended audience, so a re-send pushes nobody.

const audienceBody = (over: Record<string, unknown> = {}) => ({
  audience: 'all_members',
  type: 'fundMilestone',
  template_key: 'notif.tpl.fundMilestone',
  params: { pct: 50 },
  entity_ref: { kind: 'fund', id: 'fe-1' },
  dedupe_key: 'fund:fe-1:milestone:50',
  ...over,
});

const profiles = (...ids: string[]) => ({ data: ids.map((id) => ({ id })) });
const insertedRows = (...ids: string[]) => ({
  data: ids.map((recipient_id) => ({ recipient_id })),
});

Deno.test('audience mode writes one row per eligible member and pushes each', async () => {
  const c = ctx({
    'profiles.select': [profiles('u-1', 'u-2', 'u-3'), profiles()],
    'notifications.upsert': [insertedRows('u-1', 'u-2', 'u-3')],
  });
  const { res, body: b } = await run(c, audienceBody());

  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, recipients: 3, inserted: 3, pushed: 3, failed: 0 });

  const ins = c.db.calls.find((call) => call.table === 'notifications');
  assert(ins, 'the notifications write happened');
  assertEquals((ins.values as unknown[]).length, 3, 'ONE bulk insert, not three round trips');
  assertEquals(ins.op, 'upsert');
  // on conflict do nothing — the property a blind retry depends on (#521).
  assertEquals(ins.options, { onConflict: 'recipient_id,dedupe_key', ignoreDuplicates: true });
  assertEquals((ins.values as { dedupe_key: string }[])[0].dedupe_key, 'fund:fe-1:milestone:50');

  assertEquals(c.pushed.length, 3);
  assertEquals(c.pushed.map((p) => p.recipient_id).sort(), ['u-1', 'u-2', 'u-3']);
  // push-dispatch takes entity_ref as a STRING, same as the single path.
  assertEquals(c.pushed[0].entity_ref, JSON.stringify({ kind: 'fund', id: 'fe-1' }));
});

Deno.test('a re-send inserts nothing and pushes nobody (#521 — the retry is safe)', async () => {
  // The second run's insert conflicts on every row, so RETURNING is empty. Pushing the intended
  // audience instead of the inserted rows is exactly the bug this asserts against: it would
  // double-push the whole membership on every retry.
  const c = ctx({
    'profiles.select': [profiles('u-1', 'u-2'), profiles()],
    'notifications.upsert': [insertedRows()],
  });
  const { res, body: b } = await run(c, audienceBody());

  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, recipients: 2, inserted: 0, pushed: 0, failed: 0 });
  assertEquals(c.pushed.length, 0, 'nobody is pushed twice');
});

Deno.test('a partially-delivered broadcast pushes only the members it just inserted', async () => {
  const c = ctx({
    'profiles.select': [profiles('u-1', 'u-2', 'u-3'), profiles()],
    'notifications.upsert': [insertedRows('u-2')],
  });
  const { body: b } = await run(c, audienceBody());

  assertEquals(b, { ok: true, recipients: 3, inserted: 1, pushed: 1, failed: 0 });
  assertEquals(c.pushed.length, 1);
  assertEquals(c.pushed[0].recipient_id, 'u-2');
});

Deno.test('the audience excludes banned and currently-suspended members', async () => {
  const c = ctx({
    'profiles.select': [profiles('u-1'), profiles()],
    'notifications.upsert': [insertedRows('u-1')],
  });
  await run(c, audienceBody());

  const read = c.db.calls.find((call) => call.table === 'profiles');
  assert(read, 'the audience was resolved from profiles');
  // Mirrors athanor.is_active(): not banned, not currently suspended.
  assert(
    read.filters.some((f) => f[0] === 'is' && f[1] === 'banned_at' && f[2] === null),
    'banned members are excluded',
  );
  assert(
    read.filters.some((f) => f[0] === 'or' && String(f[1]).includes('suspended_until')),
    'currently-suspended members are excluded',
  );
});

Deno.test('the audience is paged by keyset, never by offset (rule 9)', async () => {
  // A full page means "there may be more": page 2 must resume AFTER the last id, not at an
  // offset, because a signup mid-broadcast would shift an offset and skip somebody.
  const first = Array.from({ length: AUDIENCE_PAGE }, (_, i) => `u-${String(i).padStart(5, '0')}`);
  const c = ctx({
    // Third page EMPTY: the loop ends on an empty page, never on a short one, so that a lowered
    // PostgREST max_rows cannot silently truncate the audience.
    'profiles.select': [profiles(...first), profiles('u-99999'), profiles()],
    'notifications.upsert': [insertedRows(...first), insertedRows('u-99999')],
  });
  const { body: b } = await run(c, audienceBody());

  assertEquals(b, {
    ok: true,
    recipients: AUDIENCE_PAGE + 1,
    inserted: AUDIENCE_PAGE + 1,
    pushed: AUDIENCE_PAGE + 1,
    failed: 0,
  });
  const reads = c.db.calls.filter((call) => call.table === 'profiles');
  assertEquals(reads.length, 3, 'reads continue until a page comes back empty');
  assertEquals(
    reads[0].filters.some((f) => f[0] === 'gt'),
    false,
    'the first page has no cursor',
  );
  assertEquals(reads[1].filters.find((f) => f[0] === 'gt')?.[2], first[first.length - 1]);
  assertEquals(
    reads.every((r) => r.modifiers.some((m) => m[0] === 'limit' && m[1] === AUDIENCE_PAGE)),
    true,
  );
});

Deno.test('an unknown audience name is rejected, never guessed at', async () => {
  const c = ctx();
  const { res, body: b } = await run(c, audienceBody({ audience: 'everyone_ever' }));
  assertEquals(res.status, 400);
  assertEquals(b, { error: 'unknown audience: everyone_ever' });
  assertEquals(c.db.calls.length, 0, 'nothing was read or written');
  assertEquals(c.pushed.length, 0);
});

Deno.test(
  'audience mode requires a dedupe_key — without it a retry could not be safe',
  async () => {
    for (const bad of [
      audienceBody({ dedupe_key: undefined }),
      audienceBody({ dedupe_key: '   ' }),
      audienceBody({ type: '' }),
      audienceBody({ template_key: null }),
    ]) {
      const c = ctx();
      const { res, body: b } = await run(c, bad);
      assertEquals(res.status, 400);
      assertEquals(b, { error: 'missing fields' });
      assertEquals(c.db.calls.length, 0);
      assertEquals(c.pushed.length, 0);
    }
  },
);

Deno.test(
  'a failed audience read is retried once, then 500s rather than broadcasting to nobody',
  async () => {
    const c = ctx({
      'profiles.select': [{ error: { message: 'boom' } }, { error: { message: 'boom' } }],
    });
    const { res, body: b } = await run(c, audienceBody());
    assertEquals(res.status, 500);
    assertEquals(b, { error: 'audience read failed: boom' });
    assertEquals(c.pushed.length, 0);
    assertEquals(
      c.db.calls.filter((call) => call.table === 'profiles').length,
      2,
      'the read was attempted twice before giving up',
    );
  },
);

// The failure class #521 actually observed was TRANSIENT — one enqueue of four 500'd on clock
// skew. A page that fails once and succeeds on the retry must deliver, not lose the page.
Deno.test('a transient audience read failure is recovered by the retry', async () => {
  const c = ctx({
    'profiles.select': [{ error: { message: 'flake' } }, profiles('u-1', 'u-2'), profiles()],
    'notifications.upsert': [insertedRows('u-1', 'u-2')],
  });
  const { res, body: b } = await run(c, audienceBody());
  assertEquals(res.status, 200);
  assertEquals(b, { ok: true, recipients: 2, inserted: 2, pushed: 2, failed: 0 });
});

Deno.test(
  'a push that throws never fails the broadcast (best-effort, as in the single path)',
  async () => {
    const c = ctx(
      {
        'profiles.select': [profiles('u-1', 'u-2'), profiles()],
        'notifications.upsert': [insertedRows('u-1', 'u-2')],
      },
      () => Promise.reject(new Error('expo down')),
    );
    const { res, body: b } = await run(c, audienceBody());
    assertEquals(res.status, 200);
    // The broadcast still succeeds — the in-app rows are written — but the failure is COUNTED
    // and reported rather than swallowed, so a total push outage is visible in the log.
    assertEquals(b, { ok: true, recipients: 2, inserted: 2, pushed: 0, failed: 2 });
  },
);

Deno.test(
  'a body with a recipient_id still takes the single-recipient path untouched',
  async () => {
    const c = ctx({ 'notifications.upsert': [wrote] });
    const { res, body: b } = await run(c, body());
    assertEquals(res.status, 200);
    assertEquals(b, { ok: true, pushed: true });
    const ins = c.db.calls.find((call) => call.table === 'notifications');
    // One row, not a bulk array, and no audience read at all — the shape is chosen by the body.
    assert(!Array.isArray(ins?.values));
    assertEquals(
      c.db.calls.some((call) => call.table === 'profiles'),
      false,
    );
    // An unkeyed body still writes: NULLs are distinct in the unique index, so it never
    // conflicts and a producer from before 20260824070529 behaves exactly as it did.
    assertEquals((ins?.values as { dedupe_key?: string | null }).dedupe_key, null);
    assertEquals(c.pushed.length, 1);
  },
);
