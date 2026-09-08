// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
// Characterization tests for the erasure loop: atomic lease claim (#717, the RPC flips the row
// to 'processing' and stamps claimed_at) → session revoke → fund
// reach (#240: gdpr_erase_fund_footprint rpc) → byte sweep across every declared bucket
// (#573: gdpr_storage_footprint + ./sweep.ts) → KV purge (#515) → payment pseudonymisation and
// reference release (#107: gdpr_erase_payment_footprint + gdpr_release_profile_references) →
// waitlist purge + account delete → 'done'.
//
// 'done' is new. Until #107 the clean outcome was 'partial', because the account cascade stayed
// commented behind a legal gate; the controller ruled that question on 2026-09-07 (#184) and the
// gate is gone. 'done' is now historical — the loop writes 'done' or 'failed' and nothing
// else — and 'failed' still means a step actually failed, which now includes the deliberate skip
// of the account delete when the money rows are not safe to cascade.
//
// All db I/O through injected fakes; auth and storage are recorded capability ports (no .auth /
// .storage on the fake db — DI over mocks). The sweep's own round loop is pinned in
// ./sweep.test.ts and its bucket list in ./sweep-buckets.test.ts; what is asserted here is the
// loop's use of it.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import type { KvPurgeResult } from './kv.ts';
import { type ErasureCtx, type ErasureStripe, processErasureRequests } from './logic.ts';
import { MAX_ROUNDS, REMOVE_BATCH } from './sweep.ts';

type Ctx = ErasureCtx & {
  db: FakeDb;
  revoked: string[];
  /** one entry per remove() call: the bucket it was scoped to, and the keys (#573) */
  removed: [string, string[]][];
  /** paths handed to the KV purge port, one entry per request that reached it */
  purged: string[][];
  /** profile ids handed to auth.getUserById (#107, step 4a) */
  looked: string[];
  /** profile ids handed to auth.deleteUser — the irreversible call (#107, step 4b) */
  deleted: string[];
  /** subscription ids handed to the Stripe port (#107, step 3b-bis) */
  cancelled: string[];
  /** subscription ids whose status the loop READ before cancelling (#717, step 3b-bis) */
  statusRead: string[];
};

/** No CF_KV_* trio configured — the case #515 forbids treating as a silent skip. */
const NO_KV = Symbol('unconfigured');

/** No STRIPE_SECRET_KEY on this deployment — the same doctrine, one surface over (#107). */
const NO_STRIPE = Symbol('stripe unconfigured');

const ctx = (
  script: Record<string, FakeResult[]> = {},
  overrides: {
    revokeSessions?: ErasureCtx['auth']['revokeSessions'];
    remove?: ErasureCtx['storage']['remove'];
    /** a purge result to return, or NO_KV to inject `kv: null` */
    purge?: KvPurgeResult | Promise<KvPurgeResult> | typeof NO_KV;
    getUserById?: ErasureCtx['auth']['getUserById'];
    deleteUser?: ErasureCtx['auth']['deleteUser'];
    /** a cancel implementation, or NO_STRIPE to inject `stripe: null` */
    cancelSubscription?: ErasureStripe['cancelSubscription'] | typeof NO_STRIPE;
    /** a status implementation; the default reports a live subscription, so the cancel runs */
    getSubscriptionStatus?: ErasureStripe['getSubscriptionStatus'];
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const revoked: string[] = [];
  const removed: [string, string[]][] = [];
  const purged: string[][] = [];
  const looked: string[] = [];
  const deleted: string[] = [];
  const cancelled: string[] = [];
  const statusRead: string[] = [];
  return {
    db,
    auth: {
      revokeSessions:
        overrides.revokeSessions ??
        ((id) => {
          revoked.push(id);
          return Promise.resolve(null);
        }),
      // Default: an auth row with an address, so the waitlist purge has something to run on.
      // The email is the same on every fake user; a test that cares passes its own port.
      getUserById:
        overrides.getUserById ??
        ((id) => {
          looked.push(id);
          return Promise.resolve({ data: { user: { email: 'erased@example.test' } } });
        }),
      deleteUser:
        overrides.deleteUser ??
        ((id) => {
          deleted.push(id);
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
    stripe:
      overrides.cancelSubscription === NO_STRIPE
        ? null
        : {
            // Default: a live subscription, so the cancel below runs and every pre-#717 test
            // keeps asserting what it always did. A test about the re-drive passes its own.
            getSubscriptionStatus:
              overrides.getSubscriptionStatus ??
              ((id: string) => {
                statusRead.push(id);
                return Promise.resolve('active');
              }),
            cancelSubscription:
              (overrides.cancelSubscription as ErasureStripe['cancelSubscription'] | undefined) ??
              ((id: string) => {
                cancelled.push(id);
                return Promise.resolve({});
              }),
          },
    revoked,
    removed,
    purged,
    looked,
    deleted,
    cancelled,
    statusRead,
  } as unknown as Ctx;
};

/** The kvPurge block every response carries — configured, nothing purged, nothing failed. */
const NO_PURGE = { configured: true, deleted: 0, failed: 0 };

/**
 * The whole response body. A helper rather than a literal per test so a new reported field
 * (#573 added `storageRemoved`) does not rewrite sixteen assertions — and so every test still
 * asserts the FULL body, which is what catches a field silently disappearing.
 */
const body = (
  seen: number,
  kvPurge: Record<string, unknown>,
  storageRemoved = 0,
  retained = 0,
) => ({
  seen,
  kvPurge,
  retained,
  storageRemoved,
});

/**
 * The RPCs the CASCADE ran — every rpc call except the claim itself (#717). The claim is an RPC
 * now, and it is asserted on its own above; folding it into these sequences would say the cascade
 * runs six steps per request when it runs five.
 */
const cascadeRpcs = (db: FakeDb) =>
  db.calls.filter((c) => c.op === 'rpc' && c.columns !== 'claim_erasure_requests');

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_erasure_requests' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

Deno.test('#717: the claim is the RPC, asks for the batch, and passes no lease', async () => {
  const c = ctx({ 'rpc.claim_erasure_requests': [{ data: [] }] });
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(0, NO_PURGE));

  // The claim is claim_erasure_requests and nothing else: no SELECT on the table, because the
  // SELECT-then-unguarded-UPDATE it replaced is what stranded a request torn down between the
  // two, and no second RPC, because two claims in one pass would defeat the per-member lease.
  const claims = c.db.calls.filter((k) => k.op === 'rpc' && k.columns === 'claim_erasure_requests');
  assertEquals(claims.length, 1);
  // p_limit is this loop's bound on one pass. p_lease is DELIBERATELY absent: the lease is the
  // table's, defaulted in 20260908130546, and restating it here would let the number an operator
  // reads in the migration drift from the one that runs.
  assertEquals(claims[0].values, { p_limit: 20 });
  assert(!c.db.calls.some((k) => k.table === 'gdpr_erasure_requests' && k.op === 'select'));
});

Deno.test('#717: the no-subject shortcut is fenced on the lease too', async () => {
  // The cheapest path through the loop is the one most likely to be written without the guard:
  // a request whose account is already gone writes 'done' and continues, and that write can land
  // on a row a later pass owns exactly as the long one can.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: null, claimed_at: 'lease-req-1' }] },
    ],
  });
  await processErasureRequests(c);
  const updates = statusUpdates(c.db);
  assertEquals(
    updates.map((u) => u.values),
    [{ status: 'done' }],
  );
  assertEquals(updates[0].filters, [
    ['eq', 'id', 'req-1'],
    ['eq', 'claimed_at', 'lease-req-1'],
  ]);
});

Deno.test('#717: the loop writes no status of its own before the terminal one', async () => {
  // The claim already returned these rows as 'processing'. A pass that wrote it again would be
  // writing over a lease it does not own — and on a re-claimed row, over another pass's stamp.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
  });
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test('claim error → 500 with the pg message', async () => {
  const c = ctx({ 'rpc.claim_erasure_requests': [{ error: { message: 'boom' } }] });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'boom');
  assertEquals(c.revoked.length, 0);
});

Deno.test('per request: session revoke → the whole cascade → the one terminal write', async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      {
        data: [
          { id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' },
          { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
        ],
      },
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), body(2, NO_PURGE));

  // (1) sessions revoked for EACH request, by profile id, before the terminal status.
  assertEquals(c.revoked, ['user-1', 'user-2']);

  // ONE status write per request, and it is the terminal one. Since #717 the 'processing'
  // transition belongs to claim_erasure_requests, which flips it in the same statement that
  // takes the row — the loop writing it separately was the read-then-write that stranded a
  // torn-down pass, so a second update reappearing here is that bug coming back.
  const updates = statusUpdates(c.db);
  assertEquals(
    updates.map((u) => u.values),
    [{ status: 'done' }, { status: 'done' }],
  );
  // …and it is FENCED on the lease the claim handed back (#717). Without the second filter, a
  // pass whose lease expired mid-cascade writes its terminal status over a row a later pass has
  // already re-claimed, taking it out of 'processing' while that pass is still working it.
  assertEquals(
    updates.map((u) => u.filters),
    [
      [
        ['eq', 'id', 'req-1'],
        ['eq', 'claimed_at', 'lease-req-1'],
      ],
      [
        ['eq', 'id', 'req-2'],
        ['eq', 'claimed_at', 'lease-req-2'],
      ],
    ],
  );

  // (4) the account cascade, once per request and through the auth port — never a PostgREST
  // delete against `profiles`, which would leave the auth.users row behind.
  assertEquals(c.looked, ['user-1', 'user-2']);
  assertEquals(c.deleted, ['user-1', 'user-2']);

  // The loop issues NO PostgREST delete at all: the waitlist purge is an RPC (PostgREST rewrites
  // `*` to `%` in an ilike pattern, so no filter could be made safe), and the fund reach's row
  // deletes happen inside gdpr_erase_fund_footprint's own transaction, never through this client.
  assert(!c.db.calls.some((k) => k.op === 'delete'));

  // Five RPCs per request, in order: the fund transaction, the byte sweep (#573), the payment
  // pseudonymisation, the reference release and the waitlist purge (#107). All keyed to the erased profile, and
  // the sweep asks for the capped page.
  const rpcs = cascadeRpcs(c.db);
  assertEquals(
    rpcs.map((k) => [k.columns, k.values]),
    [
      ['gdpr_erase_fund_footprint', { p_profile_id: 'user-1' }],
      ['gdpr_storage_footprint', { p_profile_id: 'user-1', p_limit: REMOVE_BATCH }],
      ['gdpr_erase_payment_footprint', { p_profile_id: 'user-1' }],
      ['gdpr_release_profile_references', { p_profile_id: 'user-1' }],
      ['gdpr_purge_waitlist_email', { p_email: 'erased@example.test' }],
      ['gdpr_erase_fund_footprint', { p_profile_id: 'user-2' }],
      ['gdpr_storage_footprint', { p_profile_id: 'user-2', p_limit: REMOVE_BATCH }],
      ['gdpr_erase_payment_footprint', { p_profile_id: 'user-2' }],
      ['gdpr_release_profile_references', { p_profile_id: 'user-2' }],
      ['gdpr_purge_waitlist_email', { p_email: 'erased@example.test' }],
    ],
  );
});

// ── #573: the byte sweep reaches EVERY bucket, not just candidacy-videos ──────────────────

Deno.test('the sweep removes from every bucket the manifest names, one call each', async () => {
  // The regression this file could not have caught before: an erased member's avatar, chat
  // images and post media all sat in buckets the loop never touched, because the storage port
  // was pre-bound to candidacy-videos.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
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
  // a clean pass, so the request lands on 'done'.
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test('the fund manifest is NOT removed a second time — the sweep owns the bytes', async () => {
  // gdpr_erase_fund_footprint still returns its candidacy-videos manifest (0104 pins it), but
  // the sweep derives the same rows from the same table for every bucket, so consuming it here
  // would be a dead Storage round trip per request.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
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
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_storage_footprint': [{ data: [] }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
});

Deno.test("a sweep that never drains lands the request on 'failed', not 'done'", async () => {
  // The Storage API answering 200 is not proof a byte is gone. sweep.ts burns its round budget
  // re-listing, and the loop must treat "not exhausted" as a failure — a member's photos still
  // in the bucket is not "did everything it could".
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_storage_footprint': Array.from({ length: MAX_ROUNDS }, () => ({
      data: [{ bucket_id: 'moments', name: 'user-1/mom-1.jpg' }],
    })),
  });
  await processErasureRequests(c);
  assertEquals(c.removed.length, MAX_ROUNDS);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test("a sweep manifest read that ERRORS is 'failed', never an empty folder", async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_storage_footprint': [{ error: { message: 'db down' } }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

// #515/#107 — the two outcomes are distinguishable: req-1's fund reach errored, so nothing
// irreversible ran for it and 'failed' is the truth; req-2 completed the whole cascade, which is
// 'done'. Before #515 both said 'failed'; before #107 the clean one said 'partial'.
Deno.test("fund reach rpc error → no byte sweep, that request lands on 'failed'", async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      {
        data: [
          { id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' },
          { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
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
    ['failed', 'done'],
  );
});

Deno.test(
  'storage.remove rejection is swallowed — loop continues to the next request',
  async () => {
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          {
            data: [
              { id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' },
              { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
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
    // 'failed', not 'done': the member's bytes are still in the bucket, so this run did NOT
    // do everything it set out to do. 'done' is reserved for a pass with nothing left behind.
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed', 'failed'],
    );
  },
);

// The revoke reports a dead dependency BOTH ways too, and the resolved one is the COMMON one:
// a failed RPC resolves with { error } rather than throwing. A run that left the member's
// tokens live must never pass for a clean 'done'.
Deno.test("a revoke resolving with an error is recorded — 'failed', not 'done'", async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { revokeSessions: () => Promise.resolve({ error: { message: 'permission denied' } }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

// The success shape is { data: <count>, error: null } — an OBJECT with an error key present
// and falsy. Guard against a truthiness check on the wrapper instead of on .error. `data: 0`
// is the session-less member, and that is a clean run, not a step that failed.
Deno.test("a revoke resolving { error: null } is a success — 'done'", async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { revokeSessions: () => Promise.resolve({ data: 0, error: null }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

// storage.remove reports a dead bucket BOTH ways: a rejected promise and a resolved
// { error }. The second shape was previously ignored outright, which would have let a run
// that left the bytes in place claim 'done'.
Deno.test("storage.remove returning an error is recorded too — 'failed', not 'done'", async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'rpc.gdpr_storage_footprint': [
        { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
      ],
    },
    { remove: () => Promise.resolve({ error: { message: 'bucket gone' } }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  "a revoke rejection is swallowed but recorded — 'failed', not 'done', loop continues",
  async () => {
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          {
            data: [
              { id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' },
              { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
            ],
          },
        ],
      },
      { revokeSessions: () => Promise.reject(new Error('rpc transport down')) },
    );
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), body(2, NO_PURGE, 0, 2));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed', 'failed'],
    );
  },
);

// ── #515 item 3: the Cloudflare KV purge of the subject's cached public pages ────────────
// apps/web caches the profile page and its OG card in KV, and a deploy strands rather than
// replaces those entries, so they outlive every row erased above (RELEASE-RUNBOOK §7.4).
// What is pinned here is the loop's contract with ./kv.ts — which paths it asks for, when a
// purge outcome may flip 'done' to 'failed', and that a KV outage never masks the DB work.

Deno.test("purges BOTH public paths for the erased handle, and stays on 'done'", async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'profiles.select': [{ data: { handle: 'luna_dev' } }],
  });
  const res = await processErasureRequests(c);

  // The page HTML too, not only the card: both carry the photo and the dream quote.
  assertEquals(c.purged, [['/@luna_dev', '/@luna_dev/opengraph-image']]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 0 }));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );

  // the handle is read from profiles, keyed to the erased id, BEFORE (4b) would cascade it away.
  const read = c.db.calls.find((k) => k.table === 'profiles' && k.op === 'select');
  assert(read);
  assertEquals(read.columns, 'handle');
  assertEquals(read.filters, [['eq', 'id', 'user-1']]);
  assertEquals(read.terminal, 'maybeSingle');
});

Deno.test("unconfigured KV is REPORTED, not skipped — 'failed', not 'done'", async () => {
  // #468/#492: a missing CF_KV_* trio must never look like a clean run. The member's card is
  // still servable from KV, so 'done' — "did everything it could" — would be a lie.
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
    },
    { purge: NO_KV },
  );
  const res = await processErasureRequests(c);

  assertEquals(await res.json(), body(1, { configured: false, deleted: 0, failed: 1 }, 0, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('unconfigured KV shows in the response even on a run that saw nothing', async () => {
  // A smoke invocation is then enough to catch a deployment that cannot purge.
  const c = ctx({ 'rpc.claim_erasure_requests': [{ data: [] }] }, { purge: NO_KV });
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(0, { configured: false, deleted: 0, failed: 0 }));
});

Deno.test('a KV API failure is recorded but never rolls back or masks the DB erasure', async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
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
  // five RPCs: the fund transaction, the sweep's two listing rounds, then #107's payment
  // pseudonymisation and reference release — a KV outage stops none of them.
  assertEquals(cascadeRpcs(c.db).length, 5);
  assertEquals(c.removed, [['candidacy-videos', ['user-1/cand-1.mp4']]]);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 1 }, 1, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('a purge that finds nothing is clean — most members were never prerendered', async () => {
  // #335 caps generateStaticParams to PRERENDER_HANDLE_LIMIT handles, so deleted: 0 is the
  // ordinary outcome and must not read as a failed erasure.
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'profiles.select': [{ data: { handle: 'luna_dev' } }],
    },
    { purge: { deleted: 0, scanned: 132 } },
  );
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), body(1, NO_PURGE));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test(
  "a member with no handle had no public URL — nothing to purge, still 'done'",
  async () => {
    const c = ctx({
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'profiles.select': [{ data: { handle: null } }],
    });
    const res = await processErasureRequests(c);
    assertEquals(c.purged, []);
    assertEquals(await res.json(), body(1, NO_PURGE));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['done'],
    );
  },
);

Deno.test("purges the subject's dream pages alongside the profile pair, in ONE sweep", async () => {
  // #159 widened the purge: apps/web serves /dream/{id} and caches it, and un-publishing a
  // dream has never deleted its cached copy. One purgePaths call, because the sweep lists the
  // whole namespace per call — two calls would list it twice for one member.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
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
    ['done'],
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
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
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
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'profiles.select': [{ data: { handle: null } }],
    'dreams.select': [{ data: ids }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged.length, 1);
  assertEquals(c.purged[0].length, 499);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 1 }, 0, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('a member with dreams but no handle still gets the dream pages purged', async () => {
  // The two key inputs are independent. This job reads with the service role, where no
  // visibility gates anything, so «no handle» here means the column is null — and it must not
  // skip the dream half, whose keys have nothing to do with the handle.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
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
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'profiles.select': [{ data: { handle: 'luna_dev' } }],
    'dreams.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, [['/@luna_dev', '/@luna_dev/opengraph-image']]);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 2, failed: 1 }, 0, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('both key reads failing counts TWO gaps and purges nothing', async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'profiles.select': [{ error: { message: 'db down' } }],
    'dreams.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);

  assertEquals(c.purged, []);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 2 }, 0, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  'unconfigured KV is reported for a member whose only cached page is a dream',
  async () => {
    // The unconfigured report must not be keyed to the handle half: this member has bytes in KV
    // and no way to purge them, which is exactly the state #468/#492 forbid skipping silently.
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'profiles.select': [{ data: { handle: null } }],
        'dreams.select': [{ data: [{ id: 'dream-1' }] }],
      },
      { purge: NO_KV },
    );
    const res = await processErasureRequests(c);

    assertEquals(await res.json(), body(1, { configured: false, deleted: 0, failed: 1 }, 0, 1));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

Deno.test('a row with no id is dropped rather than hashed into /dream/undefined', async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
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
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'profiles.select': [{ error: { message: 'db down' } }],
  });
  const res = await processErasureRequests(c);
  assertEquals(c.purged, []);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), body(1, { configured: true, deleted: 0, failed: 1 }, 0, 1));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

// ── #107: the payment reach, the reference release, and the account delete ────────────────
//
// The half that was commented out behind the legal gate. What these pin is less "the calls
// happen" than "the calls happen in an order that cannot destroy a retained money row":
// event_tickets.user_id and circle_memberships.profile_id are ON DELETE CASCADE, so deleting the
// account before the pseudonymisation has nulled them does not raise — it deletes ten years of
// financial records. Every gate below exists for that one failure mode.

Deno.test(
  'the pseudonymisation and the reference release both precede the account delete',
  async () => {
    const c = ctx({
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    });
    // Snapshot what the DB has been asked for AT THE MOMENT the irreversible call is made. The
    // two ports record independently, so plain call lists cannot show one happening before the
    // other — and the ordering is the whole safety property.
    const rpcsAtDelete: string[] = [];
    c.auth.deleteUser = (id: string) => {
      rpcsAtDelete.push(...cascadeRpcs(c.db).map((k) => k.columns as string));
      c.deleted.push(id);
      return Promise.resolve(null);
    };

    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(c.deleted, ['user-1']);
    assert(
      rpcsAtDelete.includes('gdpr_erase_payment_footprint'),
      'the money rows must already be pseudonymised when the cascade fires',
    );
    assert(
      rpcsAtDelete.includes('gdpr_release_profile_references'),
      'the blocking references must already be released when the cascade fires',
    );
  },
);

Deno.test("payment rpc error → the account is NOT deleted, and the row is 'failed'", async () => {
  // The guard that matters most. Attempting the delete here would not fail — it would cascade
  // event_tickets and circle_memberships away, which is the opposite of what the ruling says.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_erase_payment_footprint': [{ error: { message: 'deadlock' } }],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);
  assertEquals(c.deleted, []);
  assertEquals(c.looked, []); // step (4a) is inside the same gate
  assert(!c.db.calls.some((k) => k.columns === 'gdpr_purge_waitlist_email'));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  "reference release error → the account is NOT deleted, and the row is 'failed'",
  async () => {
    // Not a money risk — a leftover NO ACTION reference makes the delete FAIL rather than destroy
    // anything — but attempting it would only turn a named error into an anonymous 23503.
    const c = ctx({
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'rpc.gdpr_release_profile_references': [{ error: { message: '23503' } }],
    });
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(c.deleted, []);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

Deno.test('a failed fund reach also blocks the account delete', async () => {
  // fund_contributions.profile_id is ON DELETE RESTRICT (#378), so the delete would raise —
  // but the loop says so up front rather than leaving it to be discovered as a 23503.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_erase_fund_footprint': [{ error: { message: 'boom' } }],
  });
  await processErasureRequests(c);
  assertEquals(c.deleted, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  'the waitlist is purged by the address read from auth.users, before the delete',
  async () => {
    const looked: string[] = [];
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
      },
      {
        getUserById: (id: string) => {
          looked.push(id);
          return Promise.resolve({ data: { user: { email: 'gone@example.test' } } });
        },
      },
    );
    const seenAtDelete: string[] = [];
    c.auth.deleteUser = (id: string) => {
      seenAtDelete.push(
        ...c.db.calls.filter((k) => k.columns === 'gdpr_purge_waitlist_email').map((k) => k.op),
      );
      c.deleted.push(id);
      return Promise.resolve(null);
    };
    await processErasureRequests(c);

    assertEquals(looked, ['user-1']);
    const waitlist = c.db.calls.filter((k) => k.columns === 'gdpr_purge_waitlist_email');
    assertEquals(
      waitlist.map((k) => k.values),
      [{ p_email: 'gone@example.test' }],
    );
    // Ordering is load-bearing in the other direction too: after the auth row is gone there is
    // no address left to match on.
    assertEquals(seenAtDelete, ['rpc']);
  },
);

Deno.test("an auth row with no email → nothing to purge, still 'done'", async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { getUserById: () => Promise.resolve({ data: { user: { email: null } } }) },
  );
  await processErasureRequests(c);
  assert(!c.db.calls.some((k) => k.columns === 'gdpr_purge_waitlist_email'));
  assertEquals(c.deleted, ['user-1']);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test('an unreadable auth row BLOCKS the delete — the address is matched from it', async () => {
  // Reversed by #107's review. The waitlist row is matched against auth.users.email, and (4b)
  // is what removes auth.users: delete first and the row we were asked to erase becomes
  // unfindable. One more night with the account standing is recoverable; that is not.
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { getUserById: () => Promise.resolve({ data: null, error: { message: 'gotrue down' } }) },
  );
  await processErasureRequests(c);
  assert(!c.db.calls.some((k) => k.columns === 'gdpr_purge_waitlist_email'));
  assertEquals(c.deleted, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  'a getUserById rejection is swallowed the same way, and blocks the delete too',
  async () => {
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
      },
      { getUserById: () => Promise.reject(new Error('network')) },
    );
    await processErasureRequests(c);
    assertEquals(c.deleted, []);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

Deno.test("a failed waitlist delete is recorded — 'failed', and the account STAYS", async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_purge_waitlist_email': [{ error: { message: 'db down' } }],
  });
  await processErasureRequests(c);
  assertEquals(c.deleted, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test("a deleteUser resolving with an error is recorded — 'failed'", async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { deleteUser: () => Promise.resolve({ error: { message: 'still referenced' } }) },
  );
  await processErasureRequests(c);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('a deleteUser rejection is swallowed and the batch continues', async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        {
          data: [
            { id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' },
            { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
          ],
        },
      ],
    },
    { deleteUser: () => Promise.reject(new Error('gotrue down')) },
  );
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed', 'failed'],
  );
});

Deno.test(
  'an unconfigured KV purge blocks the delete — the uid is the only key input',
  async () => {
    // Reversed by #107's review, and this is the sharpest case for it. The KV keys and the storage
    // sweep are both derived from the member's uid, and (4b) SET NULLs that uid off the request row
    // (20260908073545). Deleting the account over a failed purge destroys the only handle that
    // could ever find the cached pages again — and the R-8 §7.5 re-drive would then mark the row
    // 'done' over residue nobody can locate.
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'profiles.select': [{ data: { handle: 'ariel' } }],
      },
      { purge: NO_KV },
    );
    await processErasureRequests(c);
    assertEquals(c.deleted, []);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

Deno.test("a request with no subject left is 'done', not a nightly 'failed' loop", async () => {
  // Reachable through the R-8 §7.5 reconcile only: 20260908073545 made profile_id ON DELETE SET
  // NULL, so a pre-#107 row re-queued by hand arrives with the account already gone. Every port
  // below would be handed `null`, and an errored port means 'failed' — the reconcile would turn
  // a stalled row into a looping one. Nothing to erase, nothing to fail.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      {
        data: [
          { id: 'req-1', profile_id: null, claimed_at: 'lease-req-1' },
          { id: 'req-2', profile_id: 'user-2', claimed_at: 'lease-req-2' },
        ],
      },
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);

  // req-1 never touched a port; req-2 in the same batch ran the whole cascade.
  assertEquals(c.revoked, ['user-2']);
  assertEquals(c.deleted, ['user-2']);
  assertEquals(
    cascadeRpcs(c.db).map((k) => k.values),
    [
      { p_profile_id: 'user-2' },
      { p_profile_id: 'user-2', p_limit: REMOVE_BATCH },
      { p_profile_id: 'user-2' },
      { p_profile_id: 'user-2' },
      { p_email: 'erased@example.test' },
    ],
  );
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done', 'done'],
  );
});

// ── #107 review: the billing does not stop by itself ──────────────────────────────────────
//
// Pseudonymising `circle_memberships` removes OUR record of who was subscribed. Stripe keeps
// charging the card monthly for an account that no longer exists, with no portal to cancel from
// and no row that points at the person — the worst outcome available, and one the member cannot
// fix themselves. So the cancellation runs before the pseudonymisation, and a failure to cancel
// stops the erasure rather than completing it.

Deno.test('the subscription is cancelled at Stripe BEFORE the row is pseudonymised', async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
  });
  const rpcsAtCancel: string[] = [];
  c.stripe = {
    getSubscriptionStatus: () => Promise.resolve('active'),
    cancelSubscription: (id: string) => {
      rpcsAtCancel.push(...cascadeRpcs(c.db).map((k) => k.columns as string));
      c.cancelled.push(id);
      return Promise.resolve({});
    },
  };

  await processErasureRequests(c);
  assertEquals(c.cancelled, ['sub_erased']);
  assert(
    !rpcsAtCancel.includes('gdpr_erase_payment_footprint'),
    'cancelling AFTER the pseudonymisation would mean cancelling a row we can no longer trace',
  );
  assertEquals(c.deleted, ['user-1']);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test(
  'a member with no subscription is not a failure and calls Stripe not at all',
  async () => {
    const c = ctx({
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'circle_memberships.select': [{ data: null }],
    });
    await processErasureRequests(c);
    assertEquals(c.cancelled, []);
    assertEquals(c.deleted, ['user-1']);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['done'],
    );
  },
);

Deno.test('an unconfigured Stripe blocks the erasure of a subscribed member', async () => {
  // Same doctrine as the KV trio: unconfigured is a state to REPORT. Finishing the erasure here
  // would leave a charge nobody can trace, refund, or stop.
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
    },
    { cancelSubscription: NO_STRIPE },
  );
  await processErasureRequests(c);
  assertEquals(c.deleted, []);
  assert(
    !c.db.calls.some((k) => k.columns === 'gdpr_erase_payment_footprint'),
    'the row must not be pseudonymised while the subscription it names is still live',
  );
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('a Stripe cancel that rejects stops the cascade where it stands', async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
    },
    { cancelSubscription: () => Promise.reject(new Error('stripe down')) },
  );
  await processErasureRequests(c);
  assertEquals(c.deleted, []);
  assert(!c.db.calls.some((k) => k.columns === 'gdpr_erase_payment_footprint'));
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test(
  'an unreadable membership row stops the cascade — unread is not «no subscription»',
  async () => {
    const c = ctx({
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'circle_memberships.select': [{ error: { message: 'db down' } }],
    });
    await processErasureRequests(c);
    assertEquals(c.cancelled, []);
    assertEquals(c.deleted, []);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

// ── #717: the cancel must survive being re-driven ────────────────────────────────────────
// The lease re-claims a request whose pass was torn down, and (3b-bis) runs BEFORE (3c) nulls
// `circle_memberships.profile_id` — so a crash between them leaves the pointer in place and the
// next pass reaches the same subscription. Cancelling it twice would turn a stranded request
// into a permanently failing one, which is worse than the bug the lease fixes.

Deno.test(
  '#717: a subscription Stripe already reports as canceled is not cancelled again',
  async () => {
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
      },
      { getSubscriptionStatus: () => Promise.resolve('canceled') },
    );
    await processErasureRequests(c);
    assertEquals(c.cancelled, []);
    // and it is NOT a degradation: the billing is stopped, which is all this step ever owed.
    assertEquals(c.deleted, ['user-1']);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['done'],
    );
  },
);

Deno.test('#717: incomplete_expired counts as settled too — Stripe closed it itself', async () => {
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
      'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
    },
    { getSubscriptionStatus: () => Promise.resolve('incomplete_expired') },
  );
  await processErasureRequests(c);
  assertEquals(c.cancelled, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['done'],
  );
});

Deno.test(
  '#717: a still-billable subscription IS cancelled, and the status was read first',
  async () => {
    // past_due is the trap: it looks broken and is still charging, so it must not be read as
    // «already stopped». Only the two terminal statuses are.
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
      },
      { getSubscriptionStatus: () => Promise.resolve('past_due') },
    );
    await processErasureRequests(c);
    assertEquals(c.cancelled, ['sub_erased']);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['done'],
    );
  },
);

Deno.test('#717: the status is read BEFORE the cancel, not alongside it', async () => {
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
  });
  await processErasureRequests(c);
  assertEquals(c.statusRead, ['sub_erased']);
  assertEquals(c.cancelled, ['sub_erased']);
});

Deno.test(
  '#717: an unreadable status stops the cascade — unread is not «already cancelled»',
  async () => {
    // Same doctrine as the unreadable membership row: carrying on would pseudonymise the row and
    // lose the only pointer to the thing still taking the member's money.
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
      },
      { getSubscriptionStatus: () => Promise.reject(new Error('stripe down')) },
    );
    await processErasureRequests(c);
    assertEquals(c.cancelled, []);
    assertEquals(c.deleted, []);
    assert(!c.db.calls.some((k) => k.columns === 'gdpr_erase_payment_footprint'));
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['failed'],
    );
  },
);

Deno.test(
  '#717: a subscription Stripe does not know is still attempted, never assumed gone',
  async () => {
    const c = ctx(
      {
        'rpc.claim_erasure_requests': [
          { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
        ],
        'circle_memberships.select': [{ data: { stripe_subscription_id: 'sub_erased' } }],
      },
      { getSubscriptionStatus: () => Promise.resolve(null) },
    );
    await processErasureRequests(c);
    assertEquals(c.cancelled, ['sub_erased']);
  },
);

// ── #107 review: a failed fund reach must stop the money steps, not just the delete ───────

Deno.test('a failed fund reach SKIPS the payment and reference steps entirely', async () => {
  // Running them anyway left a live, re-signable account whose tickets no longer scan and whose
  // Circle subscription is still billing — half-erasing a member who is still here.
  const c = ctx({
    'rpc.claim_erasure_requests': [
      { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
    ],
    'rpc.gdpr_erase_fund_footprint': [{ error: { message: 'deadlock' } }],
  });
  await processErasureRequests(c);

  const rpcs = cascadeRpcs(c.db).map((k) => k.columns);
  assertEquals(rpcs, ['gdpr_erase_fund_footprint']);
  assert(!c.db.calls.some((k) => k.table === 'circle_memberships'));
  assertEquals(c.cancelled, []);
  assertEquals(c.deleted, []);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
});

Deno.test('the waitlist address goes to the RPC verbatim — no pattern language', async () => {
  // The fold has to happen in SQL. `.eq` walks past a row stored as `Ada@X.test`, and `.ilike`
  // cannot be made safe: PostgREST rewrites `*` to `%` before Postgres sees the pattern and
  // offers no escape for it, so an address containing `*` — legal in a local part — would have
  // matched, and deleted, somebody else's row. Verified against staging.
  const c = ctx(
    {
      'rpc.claim_erasure_requests': [
        { data: [{ id: 'req-1', profile_id: 'user-1', claimed_at: 'lease-req-1' }] },
      ],
    },
    { getUserById: () => Promise.resolve({ data: { user: { email: 'a*b_c%d@x.test' } } }) },
  );
  await processErasureRequests(c);
  const waitlist = c.db.calls.filter((k) => k.columns === 'gdpr_purge_waitlist_email');
  assertEquals(
    waitlist.map((k) => k.values),
    [{ p_email: 'a*b_c%d@x.test' }],
  );
  assert(!c.db.calls.some((k) => k.op === 'delete'), 'no PostgREST filter touches the waitlist');
});
