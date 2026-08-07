// deno test supabase/functions/gdpr-export-job/ — runs in CI (edge job) and locally.
// Characterization tests for the export loop. THE critical invariant (10 §5.3): every
// archive query filters by the requester's own id, with the per-table owner column.
// All db I/O through injected fakes; storage is a recorded capability port (no .storage
// on the fake db — DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  assembleArchive,
  type ExportJobCtx,
  type ExportStorage,
  processExportJobs,
  SIGNED_TTL_SECONDS,
} from './logic.ts';

const JOB = 'job-1';
const REQUESTER = 'user-1';

type Ctx = ExportJobCtx & {
  db: FakeDb;
  uploads: { path: string; body: string; opts: unknown }[];
  signs: { path: string; ttl: number }[];
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  storage: Partial<ExportStorage> = {},
): Ctx => {
  const db = makeFakeDb({
    'gdpr_export_jobs.select': [{ data: [{ id: JOB, profile_id: REQUESTER }] }],
    ...script,
  });
  const uploads: Ctx['uploads'] = [];
  const signs: Ctx['signs'] = [];
  return {
    db,
    storage: {
      upload:
        storage.upload ??
        ((path, body, opts) => {
          uploads.push({ path, body, opts });
          return Promise.resolve({ error: null });
        }),
      createSignedUrl:
        storage.createSignedUrl ??
        ((path, ttl) => {
          signs.push({ path, ttl });
          return Promise.resolve({ data: { signedUrl: 'https://signed.example/x' } });
        }),
    },
    uploads,
    signs,
  } as unknown as Ctx;
};

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_export_jobs' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

// ── archive assembly (pure) ──────────────────────────────────────────────────

Deno.test('assembleArchive: shapes the six results, defaulting null → null / []', () => {
  const empty = assembleArchive('2026-08-07T00:00:00.000Z', {
    profile: { data: null },
    dreams: { data: null },
    posts: { data: null },
    moments: { data: null },
    messages: { data: null },
    consent: { data: null },
  });
  assertEquals(empty, {
    exported_at: '2026-08-07T00:00:00.000Z',
    profile: null,
    dreams: [],
    posts: [],
    moments: [],
    messages: [],
    consent: [],
  });

  const full = assembleArchive('2026-08-07T00:00:00.000Z', {
    profile: { data: { id: REQUESTER } },
    dreams: { data: [{ id: 'd1' }] },
    posts: { data: [{ id: 'p1' }] },
    moments: { data: [{ id: 'm1' }] },
    messages: { data: [{ id: 'msg1' }] },
    consent: { data: [{ id: 'c1' }] },
  });
  assertEquals(full.profile, { id: REQUESTER });
  assertEquals(full.dreams, [{ id: 'd1' }]);
});

// ── the own-data invariant ───────────────────────────────────────────────────

Deno.test(
  'claim query + all six archive queries filter by the requester (per-table column)',
  async () => {
    const c = ctx();
    await processExportJobs(c);

    // claim: status='requested', batched
    const claim = c.db.calls.find(
      (call) => call.table === 'gdpr_export_jobs' && call.op === 'select',
    );
    assert(claim);
    assertEquals(claim.filters, [['eq', 'status', 'requested']]);
    assertEquals(claim.modifiers, [['limit', 50]]);

    // own-data (10 §5.3): each table filtered by the requester's id via ITS owner column.
    const expected: [string, string][] = [
      ['profiles', 'id'],
      ['dreams', 'profile_id'],
      ['posts', 'author_id'],
      ['moments', 'owner_id'],
      ['messages', 'sender_id'],
      ['consent', 'profile_id'],
    ];
    for (const [table, column] of expected) {
      const call = c.db.calls.find((k) => k.table === table);
      assert(call, `${table} queried`);
      assertEquals(call.op, 'select');
      assertEquals(call.columns, '*');
      assertEquals(call.filters, [['eq', column, REQUESTER]], `${table} filtered by ${column}`);
    }
  },
);

// ── upload failure → requeue ─────────────────────────────────────────────────

Deno.test("upload failure → job requeued (status back to 'requested'), never 'ready'", async () => {
  const c = ctx({}, { upload: () => Promise.resolve({ error: { message: 'bucket down' } }) });
  const res = await processExportJobs(c);

  const updates = statusUpdates(c.db);
  assertEquals(
    updates.map((u) => u.values.status),
    ['processing', 'requested'],
  );
  assert(
    updates.every((u) => u.filters.some(([f, col, v]) => f === 'eq' && col === 'id' && v === JOB)),
  );
  assertEquals(c.signs.length, 0); // never signs a URL for a failed upload

  // the run itself still reports the batch it saw (retry happens next cron run)
  assertEquals(await res.json(), { processed: 1 });
});

// ── happy path ───────────────────────────────────────────────────────────────

Deno.test(
  "happy path → upload to <profile>/<job>.json, then 'ready' + signed url + expiry",
  async () => {
    const c = ctx();
    const res = await processExportJobs(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { processed: 1 });

    assertEquals(c.uploads.length, 1);
    assertEquals(c.uploads[0].path, `${REQUESTER}/${JOB}.json`);
    assertEquals(c.uploads[0].opts, { contentType: 'application/json', upsert: true });
    const archived = JSON.parse(c.uploads[0].body);
    assertEquals(archived.profile, null); // unscripted queries → the empty archive shape
    assertEquals(archived.dreams, []);

    assertEquals(c.signs, [{ path: `${REQUESTER}/${JOB}.json`, ttl: SIGNED_TTL_SECONDS }]);

    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values.status),
      ['processing', 'ready'],
    );
    const ready = updates[1].values;
    assertEquals(ready.download_url, 'https://signed.example/x');
    assert(typeof ready.expires_at === 'string' && !Number.isNaN(Date.parse(ready.expires_at)));
  },
);

Deno.test('claim error → 500 with the pg message; no job touched', async () => {
  const c = ctx({ 'gdpr_export_jobs.select': [{ error: { message: 'boom' } }] });
  const res = await processExportJobs(c);
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'boom');
  assertEquals(c.uploads.length, 0);
  assertEquals(statusUpdates(c.db).length, 0);
});

Deno.test('empty batch → processed 0', async () => {
  const c = ctx({ 'gdpr_export_jobs.select': [{ data: [] }] });
  const res = await processExportJobs(c);
  assertEquals(await res.json(), { processed: 0 });
});
