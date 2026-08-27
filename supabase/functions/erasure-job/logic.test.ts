// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
// Characterization tests for the legal-gated erasure loop: claim → 'processing' →
// session revoke → fund reach (#240: gdpr_erase_fund_footprint rpc) → byte sweep across
// every declared bucket (#573: gdpr_storage_footprint + ./sweep.ts) → 'partial'
// (intentionally NOT 'done' — the account cascade stays commented until the legal gate
// clears, and a partial erasure must never report complete; #515 gave that stop-short its
// own status, so 'failed' now means a step actually failed). All db I/O through injected
// fakes; auth and storage are recorded capability ports (no .auth / .storage on the fake db
// — DI over mocks). The sweep's own round loop is pinned in ./sweep.test.ts and its bucket
// list in ./sweep-buckets.test.ts; what is asserted here is the loop's use of it.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import type { KvPurgeResult } from './kv.ts';
import { type ErasureCtx, processErasureRequests } from './logic.ts';
import { MAX_ROUNDS, REMOVE_BATCH } from './sweep.ts';

type Ctx = ErasureCtx & {
  db: FakeDb;
  revoked: string[];
  /** one entry per remove() call: the bucket it was scoped to, and the keys (#573) */
  removed: [string, string[]][];
  /** paths handed to the KV purge port, one entry per request that reached it */
  purged: string[][];
};

/** No CF_KV_* trio configured — the case #515 forbids treating as a silent skip. */
const NO_KV = Symbol('unconfigured');

const ctx = (
  script: Record<string, FakeResult[]> = {},
  overrides: {
    revokeSessions?: ErasureCtx['auth']['revokeSessions'];
    remove?: ErasureCtx['storage']['remove'];
    /** a purge result to return, or NO_KV to inject `kv: null` */
    purge?: KvPurgeResult | Promise<KvPurgeResult> | typeof NO_KV;
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const revoked: string[] = [];
  const removed: [string, string[]][] = [];
  const purged: string[][] = [];
  return {
    db,
    auth: {
      revokeSessions:
        overrides.revokeSessions ??
        ((id) => {
          revoked.push(id);
          return Promise.resolve(null);
        }),
    },
    storage: {
      remove:
        overrides.remove ??
        ((bucket, paths) => {
          removed.push([bucket, paths]);
          return Promise.resolve({ error: null });
        }),
    },
    kv:
      overrides.purge === NO_KV
        ? null
        : {
            purgePaths: (paths: string[]) => {
              purged.push(paths);
              return Promise.resolve(
                (overrides.purge as KvPurgeResult | undefined) ?? { deleted: 2, scanned: 9 },
              );
            },
          },
    revoked,
    removed,
    purged,
  } as unknown as Ctx;
};

/** The kvPurge block every response carries — configured, nothing purged, nothing failed. */
const NO_PURGE = { configured: true, deleted: 0, failed: 0 };

/**
 * The whole response body. A helper rather than a literal per test so a new reported field
 * (#573 added `storageRemoved`) does not rewrite sixteen assertions — and so every test still
 * asserts the FULL body, which is what catches a field silently disappearing.
 */
const body = (seen: number, kvPurge: Record<string, unknown>, storageRemoved = 0) => ({
  seen,
  kvPurge,
  storageRemoved,
});

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_erasure_requests' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

Deno.test("claim query batches status='requested' limit 20", async () => {
  const c = ctx({ 'gdpr_erasure_requests.select': [{ data: [] }] });
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(0, NO_PURGE));

  const claim = c.db.calls.find((k) => k.table === 'gdpr_erasure_requests' && k.op === 'select');
  assert(claim);
  assertEquals(claim.columns, 'id, profile_id');
  assertEquals(claim.filters, [['eq', 'status', 'requested']]);
  assertEquals(claim.modifiers, [['limit', 20]]);
});

Deno.test('claim error → 500 with the pg message', async () => {
  const c = ctx({ 'gdpr_erasure_requests.select': [{ error: { message: 'boom' } }] });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'boom');
  assertEquals(c.revoked.length, 0);
});

Deno.test(
  "per request: 'processing' → session revoke → 'partial' (legal-gated, never 'done')",
  async () => {
    const c = ctx({
      'gdpr_erasure_requests.select': [
        {
          data: [
            { id: 'req-1', profile_id: 'user-1' },
            { id: 'req-2', profile_id: 'user-2' },
          ],
        },
      ],
    });
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), body(2, NO_PURGE));

    // (1) sessions revoked for EACH request, by profile id, before the terminal status.
    assertEquals(c.revoked, ['user-1', 'user-2']);

    // requested→processing→failed per request, each update keyed to its own id.
    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values),
      [
        { status: 'processing' },
        { status: 'partial' },
        { status: 'processing' },
        { status: 'partial' },
      ],
    );
    assertEquals(
      updates.map((u) => u.filters),
      [
        [['eq', 'id', 'req-1']],
        [['eq', 'id', 'req-1']],
        [['eq', 'id', 'req-2']],
        [['eq', 'id', 'req-2']],
      ],
    );

    // the ACCOUNT cascade is NOT performed while legal-gated: no PostgREST deletes anywhere.
    // (The fund reach (#240) is the gdpr_erase_fund_footprint rpc, asserted below — its row
    // deletes happen inside that DB transaction, never through this client.)
    assert(!c.db.calls.some((k) => k.op === 'delete'));

    // Two RPCs per request, in order: the fund transaction, then the byte sweep (#573).
    // Both keyed to the erased profile, and the sweep asks for the capped page.
    const rpcs = c.db.calls.filter((k) => k.op === 'rpc');
    assertEquals(
      rpcs.map((k) => [k.columns, k.values]),
      [
        ['gdpr_erase_fund_footprint', { p_profile_id: 'user-1' }],
        ['gdpr_storage_footprint', { p_profile_id: 'user-1', p_limit: REMOVE_BATCH }],
        ['gdpr_erase_fund_footprint', { p_profile_id: 'user-2' }],
        ['gdpr_storage_footprint', { p_profile_id: 'user-2', p_limit: REMOVE_BATCH }],
      ],
    );
  },
);

// ── #573: the byte sweep reaches EVERY bucket, not just candidacy-videos ──────────────────

Deno.test('the sweep removes from every bucket the manifest names, one call each', async () => {
  // The regression this file could not have caught before: an erased member's avatar, chat
  // images and post media all sat in buckets the loop never touched, because the storage port
  // was pre-bound to candidacy-videos.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_storage_footprint': [
      {
        data: [
          { bucket_id: 'avatars', name: 'user-1/user-1.jpg' },
          { bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' },
          { bucket_id: 'candidacy-videos', name: 'user-1/cand-1-thumb.jpg' },
          { bucket_id: 'chat-media', name: 'user-1/conv-1/m-1.jpg' },
          { bucket_id: 'exports', name: 'user-1/job-1.json' },
        ],
      },
      { data: [] }, // the round that proves the folder drained
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);

  assertEquals(c.removed, [
    ['avatars', ['user-1/user-1.jpg']],
    ['candidacy-videos', ['user-1/cand-1.mp4', 'user-1/cand-1-thumb.jpg']],
    ['chat-media', ['user-1/conv-1/m-1.jpg']],
    ['exports', ['user-1/job-1.json']],
  ]);
  // five keys, reported — a run that erased a member and reports 0 is the old bug's signature.
  assertEquals(await res.json(), body(1, NO_PURGE, 5));
  // still legal-gated: the request lands on 'partial', never 'done'.
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'partial'],
  );
});

Deno.test('the fund manifest is NOT removed a second time — the sweep owns the bytes', async () => {
  // gdpr_erase_fund_footprint still returns its candidacy-videos manifest (0104 pins it), but
  // the sweep derives the same rows from the same table for every bucket, so consuming it here
  // would be a dead Storage round trip per request.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_erase_fund_footprint': [
      { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
    ],
    'rpc.gdpr_storage_footprint': [{ data: [] }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
});

Deno.test('an empty sweep manifest → no storage call at all', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_storage_footprint': [{ data: [] }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
});

Deno.test("a sweep that never drains lands the request on 'failed', not 'partial'", async () => {
  // The Storage API answering 200 is not proof a byte is gone. sweep.ts burns its round budget
  // re-listing, and the loop must treat "not exhausted" as a failure — a member's photos still
  // in the bucket is not "did everything it could".
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_storage_footprint': Array.from({ length: MAX_ROUNDS }, () => ({
      data: [{ bucket_id: 'moments', name: 'user-1/mom-1.jpg' }],
    })),
  });
  await processErasureRequests(c);
  assertEquals(c.removed.length, MAX_ROUNDS);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test("a sweep manifest read that ERRORS is 'failed', never an empty folder", async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_storage_footprint': [{ error: { message: 'db down' } }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

// #515 — the two outcomes are now distinguishable: req-1's fund reach errored, so nothing
// irreversible ran for it and 'failed' is the truth; req-2 did everything it could and stopped
// at the legal gate, which is 'partial'. Before this, both said 'failed'.
Deno.test("fund reach rpc error → no byte sweep, that request lands on 'failed'", async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [
      {
        data: [
          { id: 'req-1', profile_id: 'user-1' },
          { id: 'req-2', profile_id: 'user-2' },
        ],
      },
    ],
    'rpc.gdpr_erase_fund_footprint': [{ error: { message: 'db down' } }, { data: [] }],
    // Only req-2 reaches the sweep, so only req-2 consumes a page of this script.
    'rpc.gdpr_storage_footprint': [
      { data: [{ bucket_id: 'candidacy-videos', name: 'user-2/cand-2.mp4' }] },
      { data: [] },
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);

  // req-1's fund transaction never ran, so its bytes are deliberately left alone: that
  // transaction deletes the dream_candidacies rows whose video_url points at these keys, and
  // removing bytes out from under live rows would leave a broken video on other members'
  // screens until the request is re-driven. req-2 proceeds normally.
  assertEquals(c.removed, [['candidacy-videos', ['user-2/cand-2.mp4']]]);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed', 'processing', 'partial'],
  );
});

Deno.test(
  'storage.remove rejection is swallowed — loop continues to the next request',
  async () => {
    const c = ctx(
      {
        'gdpr_erasure_requests.select': [
          {
            data: [
              { id: 'req-1', profile_id: 'user-1' },
              { id: 'req-2', profile_id: 'user-2' },
            ],
          },
        ],
        'rpc.gdpr_storage_footprint': [
          { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
          { data: [{ bucket_id: 'candidacy-videos', name: 'user-2/cand-2.mp4' }] },
        ],
      },
      { remove: () => Promise.reject(new Error('storage down')) },
    );
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    // both requests still reach a terminal status despite the dead Storage API — and it is
    // 'failed', not 'partial': the member's bytes are still in the bucket, so this run did NOT
    // do everything it set out to do. 'partial' is reserved for a clean stop at the legal gate.
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed', 'processing', 'failed'],
    );
  },
);

// The revoke reports a dead dependency BOTH ways too, and the resolved one is the COMMON one:
// a failed RPC resolves with { error } rather than throwing. A run that left the member's
// tokens live must never pass for a clean 'partial'.
Deno.test("a revoke resolving with an error is recorded — 'failed', not 'partial'", async () => {
  const c = ctx(
    { 'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }] },
    { revokeSessions: () => Promise.resolve({ error: { message: 'permission denied' } }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

// The success shape is { data: <count>, error: null } — an OBJECT with an error key present
// and falsy. Guard against a truthiness check on the wrapper instead of on .error. `data: 0`
// is the session-less member, and that is a clean run, not a step that failed.
Deno.test("a revoke resolving { error: null } is a success — 'partial'", async () => {
  const c = ctx(
    { 'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }] },
    { revokeSessions: () => Promise.resolve({ data: 0, error: null }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'partial'],
  );
});

// storage.remove reports a dead bucket BOTH ways: a rejected promise and a resolved
// { error }. The second shape was previously ignored outright, which would have let a run
// that left the bytes in place claim 'partial'.
Deno.test(
  "storage.remove returning an error is recorded too — 'failed', not 'partial'",
  async () => {
    const c = ctx(
      {
        'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
        'rpc.gdpr_storage_footprint': [
          { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
        ],
      },
      { remove: () => Promise.resolve({ error: { message: 'bucket gone' } }) },
    );
    await processErasureRequests(c);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed'],
    );
  },
);

Deno.test(
  "a revoke rejection is swallowed but recorded — 'failed', not 'partial', loop continues",
  async () => {
    const c = ctx(
      {
        'gdpr_erasure_requests.select': [
          {
            data: [
              { id: 'req-1', profile_id: 'user-1' },
              { id: 'req-2', profile_id: 'user-2' },
            ],
          },
        ],
      },
      { revokeSessions: () => Promise.reject(new Error('rpc transport down')) },
    );
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), body(2, NO_PURGE));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed', 'processing', 'failed'],
    );
  },
);

// ── #515 item 3: the Cloudflare KV purge of the subject's cached public pages ────────────
// apps/web caches the profile page and its OG card in KV, and a deploy strands rather than
// replaces those entries, so they outlive every row erased above (RELEASE-RUNBOOK §7.4).
// What is pinned here is the loop's contract with ./kv.ts — which paths it asks for, when a
// purge outcome may flip 'partial' to 'failed', and that a KV outage never masks the DB work.

Deno.test('purges BOTH public paths for the erased handle, and stays on partial', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: 'luna_dev' } }],
  });
  const res = await processErasureRequests(c);

  // The page HTML too, not only the card: both carry the photo and the dream quote.
  assertEquals(c.purged, [['/@luna_dev', '/@luna_dev/opengraph-image']]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 0 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'partial'],
  );

  // the handle is read from profiles, keyed to the erased id, BEFORE (4b) would cascade it away.
  const read = c.db.calls.find((k) => k.table === 'profiles' && k.op === 'select');
  assert(read);
  assertEquals(read.columns, 'handle');
  assertEquals(read.filters, [['eq', 'id', 'user-1']]);
  assertEquals(read.terminal, 'maybeSingle');
});

Deno.test("unconfigured KV is REPORTED, not skipped — 'failed', not 'partial'", async () => {
  // #468/#492: a missing CF_KV_* trio must never look like a clean run. The member's card is
  // still servable from KV, so 'partial' — "did everything it could" — would be a lie.
  const c = ctx(
    {
      'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
    },
    { purge: NO_KV },
  );
  const res = await processErasureRequests(c);

  assertEquals(await res.json(), body(1, { configured: false, deleted: 0, failed: 1 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test('unconfigured KV shows in the response even on a run that saw nothing', async () => {
  // A smoke invocation is then enough to catch a deployment that cannot purge.
  const c = ctx({ 'gdpr_erasure_requests.select': [{ data: [] }] }, { purge: NO_KV });
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(0, { configured: false, deleted: 0, failed: 0 }));
});

Deno.test('a KV API failure is recorded but never rolls back or masks the DB erasure', async () => {
  const c = ctx(
    {
      'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
      'rpc.gdpr_storage_footprint': [
        { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
        { data: [] },
      ],
    },
    { purge: { deleted: 0, scanned: 4, error: new Error('KV list failed: 500') } },
  );
  const res = await processErasureRequests(c);

  // The irreversible DB work still happened and is still reported as having happened —
  // a Cloudflare outage must not turn a completed cascade into a 500 or a rollback.
  assertEquals(res.status, 200);
  // three RPCs: the fund transaction, then the sweep's two listing rounds.
  assertEquals(c.db.calls.filter((k) => k.op === 'rpc').length, 3);
  assertEquals(c.removed, [['candidacy-videos', ['user-1/cand-1.mp4']]]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 1 }, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test('a purge that finds nothing is clean — most members were never prerendered', async () => {
  // #335 caps generateStaticParams to PRERENDER_HANDLE_LIMIT handles, so deleted: 0 is the
  // ordinary outcome and must not read as a failed erasure.
  const c = ctx(
    {
      'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
    },
    { purge: { deleted: 0, scanned: 132 } },
  );
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(1, NO_PURGE));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'partial'],
  );
});

Deno.test(
  'a member with no handle had no public URL — nothing to purge, still partial',
  async () => {
    const c = ctx({
      'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
      'profiles.select': [{ data: { handle: null } }],
    });
    const res = await processErasureRequests(c);
    assertEquals(c.purged, []);
    assertEquals(await res.json(), body(1, NO_PURGE));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'partial'],
    );
  },
);

Deno.test("purges the subject's dream pages alongside the profile pair, in ONE sweep", async () => {
  // #159 widened the purge: apps/web serves /dream/{id} and caches it, and un-publishing a
  // dream has never deleted its cached copy. One purgePaths call, because the sweep lists the
  // whole namespace per call — two calls would list it twice for one member.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: 'luna_dev' } }],
    'dreams.select': [{ data: [{ id: 'dream-1' }, { id: 'dream-2' }] }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, [
    ['/@luna_dev', '/@luna_dev/opengraph-image', '/dream/dream-1', '/dream/dream-2'],
  ]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 0 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'partial'],
  );
});

Deno.test(
  'the dream read is UNFILTERED — an archived or deleted dream still has a cached page',
  async () => {
    // The deliberate asymmetry with the reader in packages/api: `status = 'active'` and
    // `deleted_at is null` describe what the page serves today, and this is about what KV
    // cached yesterday. Filtering here would leave the text of an archived dream readable by
    // key, forever, under a dead build prefix.
    const c = ctx({
      'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
      'dreams.select': [{ data: [{ id: 'dream-1' }] }],
    });
    await processErasureRequests(c);

    const read = c.db.calls.find((k) => k.table === 'dreams' && k.op === 'select');
    assert(read);
    assertEquals(read.columns, 'id');
    // Keyed to the erased profile and to NOTHING else — before (4b) would cascade the rows away.
    assertEquals(read.filters, [['eq', 'profile_id', 'user-1']]);
    // Ordered and bounded: PostgREST truncates at max_rows with no error, so an unbounded read
    // would drop the tail silently. See the full-page test below.
    assertEquals(read.modifiers, [
      ['order', 'id', { ascending: true }],
      ['limit', 500],
    ]);
  },
);

Deno.test('a FULL page of dream ids is a purge gap — a truncated read raises nothing', async () => {
  // PostgREST caps at max_rows and returns the short page with error: null, so «exactly the
  // limit» and «the limit, plus more we never saw» are indistinguishable. The keys we did
  // derive are still purged; what must not happen is reporting the sweep as complete.
  // One row with no id, so the guard is exercised on the RAW page size: filtering first would
  // leave 499 and let a possibly-truncated read report as a complete one.
  const ids = Array.from({ length: 500 }, (_, i) =>
    i === 7 ? { id: null } : { id: `dream-${i}` },
  );
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: null } }],
    'dreams.select': [{ data: ids }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged.length, 1);
  assertEquals(c.purged[0].length, 499);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 1 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test('a member with dreams but no handle still gets the dream pages purged', async () => {
  // The two key inputs are independent. This job reads with the service role, where no
  // visibility gates anything, so «no handle» here means the column is null — and it must not
  // skip the dream half, whose keys have nothing to do with the handle.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: null } }],
    'dreams.select': [{ data: [{ id: 'dream-1' }] }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, [['/dream/dream-1']]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 0 }));
});

Deno.test("a failed dreams read is counted as a purge gap, not as 'no dreams'", async () => {
  // Same rule as the handle read: a read that FAILED and a member who never had a dream reach
  // the same code with the same empty list, and only one of them is a clean sweep. The handle
  // half still runs — a gap in one input must not abandon the other.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: 'luna_dev' } }],
    'dreams.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, [['/@luna_dev', '/@luna_dev/opengraph-image']]);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 1 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test('both key reads failing counts TWO gaps and purges nothing', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ error: { message: 'db down' } }],
    'dreams.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, []);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 2 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test(
  'unconfigured KV is reported for a member whose only cached page is a dream',
  async () => {
    // The unconfigured report must not be keyed to the handle half: this member has bytes in KV
    // and no way to purge them, which is exactly the state #468/#492 forbid skipping silently.
    const c = ctx(
      {
        'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
        'profiles.select': [{ data: { handle: null } }],
        'dreams.select': [{ data: [{ id: 'dream-1' }] }],
      },
      { purge: NO_KV },
    );
    const res = await processErasureRequests(c);

    assertEquals(await res.json(), body(1, { configured: false, deleted: 0, failed: 1 }));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed'],
    );
  },
);

Deno.test('a row with no id is dropped rather than hashed into /dream/undefined', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ data: { handle: null } }],
    'dreams.select': [{ data: [{ id: null }, { id: 'dream-1' }] }],
  });
  await processErasureRequests(c);
  assertEquals(c.purged, [['/dream/dream-1']]);
});

Deno.test("a failed handle read is counted as a purge gap, not as 'no handle'", async () => {
  // Without the handle there is no key to derive, so the cached page survives the erasure.
  // A read that FAILED and a member who never had a handle reach the same code with the same
  // `handle === null`, and they must not report the same way: this one is a real gap.
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'profiles.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);
  assertEquals(c.purged, []);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 1 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});
