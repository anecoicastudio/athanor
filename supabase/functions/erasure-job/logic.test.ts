// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
// Characterization tests for the legal-gated erasure loop: claim → 'processing' →
// session revoke → fund reach (#240: gdpr_erase_fund_footprint rpc + blob removal) →
// 'failed' (intentionally NOT 'done' — the account cascade stays commented until the
// legal gate clears, and a partial erasure must never report complete). All db I/O
// through injected fakes; auth and storage are recorded capability ports (no .auth /
// .storage on the fake db — DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { type ErasureCtx, processErasureRequests } from './logic.ts';

type Ctx = ErasureCtx & { db: FakeDb; signedOut: [string, string][]; removed: string[][] };

const ctx = (
  script: Record<string, FakeResult[]> = {},
  overrides: {
    signOut?: ErasureCtx['auth']['signOut'];
    remove?: ErasureCtx['storage']['remove'];
  } = {},
): Ctx => {
  const db = makeFakeDb(script);
  const signedOut: [string, string][] = [];
  const removed: string[][] = [];
  return {
    db,
    auth: {
      signOut:
        overrides.signOut ??
        ((id, scope) => {
          signedOut.push([id, scope]);
          return Promise.resolve();
        }),
    },
    storage: {
      remove:
        overrides.remove ??
        ((paths) => {
          removed.push(paths);
          return Promise.resolve({ error: null });
        }),
    },
    signedOut,
    removed,
  } as unknown as Ctx;
};

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_erasure_requests' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

Deno.test("claim query batches status='requested' limit 20", async () => {
  const c = ctx({ 'gdpr_erasure_requests.select': [{ data: [] }] });
  const res = await processErasureRequests(c);
  assertEquals(await res.json(), { seen: 0 });

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
  assertEquals(c.signedOut.length, 0);
});

Deno.test(
  "per request: 'processing' → global signOut → 'failed' (legal-gated, never 'done')",
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
    assertEquals(await res.json(), { seen: 2 });

    // (1) sessions revoked for EACH request, global scope, before the terminal status.
    assertEquals(c.signedOut, [
      ['user-1', 'global'],
      ['user-2', 'global'],
    ]);

    // requested→processing→failed per request, each update keyed to its own id.
    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values),
      [
        { status: 'processing' },
        { status: 'failed' },
        { status: 'processing' },
        { status: 'failed' },
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

    // fund reach invoked once per request, keyed to the erased profile.
    const rpcs = c.db.calls.filter((k) => k.op === 'rpc');
    assertEquals(
      rpcs.map((k) => [k.columns, k.values]),
      [
        ['gdpr_erase_fund_footprint', { p_profile_id: 'user-1' }],
        ['gdpr_erase_fund_footprint', { p_profile_id: 'user-2' }],
      ],
    );
  },
);

Deno.test('fund reach: manifest paths are removed from the candidacy-videos port', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_erase_fund_footprint': [
      {
        data: [
          { bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' },
          { bucket_id: 'candidacy-videos', name: 'user-1/cand-1-thumb.jpg' },
        ],
      },
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);

  // one remove call, both blobs, video + poster together.
  assertEquals(c.removed, [['user-1/cand-1.mp4', 'user-1/cand-1-thumb.jpg']]);
  // still legal-gated: the request lands on 'failed', never 'done'.
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed'],
  );
});

Deno.test('fund reach: empty manifest → no storage call at all', async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [{ data: [{ id: 'req-1', profile_id: 'user-1' }] }],
    'rpc.gdpr_erase_fund_footprint': [{ data: [] }],
  });
  await processErasureRequests(c);
  assertEquals(c.removed, []);
});

Deno.test("fund reach rpc error → no blob removal, request still lands on 'failed'", async () => {
  const c = ctx({
    'gdpr_erasure_requests.select': [
      {
        data: [
          { id: 'req-1', profile_id: 'user-1' },
          { id: 'req-2', profile_id: 'user-2' },
        ],
      },
    ],
    'rpc.gdpr_erase_fund_footprint': [
      { error: { message: 'db down' } },
      { data: [{ bucket_id: 'candidacy-videos', name: 'user-2/cand-2.mp4' }] },
    ],
  });
  const res = await processErasureRequests(c);
  assertEquals(res.status, 200);

  // req-1's manifest never arrived → nothing removed for it; req-2 proceeds normally.
  assertEquals(c.removed, [['user-2/cand-2.mp4']]);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['processing', 'failed', 'processing', 'failed'],
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
        'rpc.gdpr_erase_fund_footprint': [
          { data: [{ bucket_id: 'candidacy-videos', name: 'user-1/cand-1.mp4' }] },
          { data: [{ bucket_id: 'candidacy-videos', name: 'user-2/cand-2.mp4' }] },
        ],
      },
      { remove: () => Promise.reject(new Error('storage down')) },
    );
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    // both requests still reach their terminal status despite the dead Storage API.
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed', 'processing', 'failed'],
    );
  },
);

Deno.test(
  "signOut rejection is swallowed — request still lands on 'failed', loop continues",
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
      { signOut: () => Promise.reject(new Error('gotrue down')) },
    );
    const res = await processErasureRequests(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { seen: 2 });
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['processing', 'failed', 'processing', 'failed'],
    );
  },
);
