// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
// Characterization tests for the legal-gated erasure loop: claim → 'processing' →
// session revoke → 'failed' (intentionally NOT 'done' — the destructive cascade stays
// commented until the legal gate clears). All db I/O through injected fakes; auth is
// a recorded capability port (no .auth on the fake db — DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { type ErasureCtx, processErasureRequests } from './logic.ts';

type Ctx = ErasureCtx & { db: FakeDb; signedOut: [string, string][] };

const ctx = (
  script: Record<string, FakeResult[]> = {},
  signOut?: ErasureCtx['auth']['signOut'],
): Ctx => {
  const db = makeFakeDb(script);
  const signedOut: [string, string][] = [];
  return {
    db,
    auth: {
      signOut:
        signOut ??
        ((id, scope) => {
          signedOut.push([id, scope]);
          return Promise.resolve();
        }),
    },
    signedOut,
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

    // the destructive cascade is NOT performed while legal-gated: no deletes anywhere.
    assert(!c.db.calls.some((k) => k.op === 'delete'));
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
      () => Promise.reject(new Error('gotrue down')),
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
