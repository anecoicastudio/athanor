// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
//
// #573: the account-wide byte sweep. What is pinned here is the loop's contract — that a
// remove() is issued per bucket, that the only clean end is a listing that came back empty,
// and that every way this can quietly do nothing (a failed read, malformed rows, a Storage API
// that answers 200 and deletes nothing) is reported as a failure rather than as a swept member.
// The bucket LIST is not asserted here; it lives in SQL and is pinned by ./sweep-buckets.test.ts.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { MAX_ROUNDS, REMOVE_BATCH, type SweepPorts, sweepMemberStorage } from './sweep.ts';

type Listed = { data: unknown; error: unknown };
type Removed = { error: unknown };

const ports = (
  script: {
    list?: Listed[];
    /** default result for every remove(); `perBucket` overrides it by bucket name */
    remove?: Removed | (() => PromiseLike<Removed>);
    perBucket?: Record<string, Removed>;
  } = {},
) => {
  const listCalls: [string, number][] = [];
  const removeCalls: [string, string[]][] = [];
  const queue = [...(script.list ?? [])];
  const p: SweepPorts = {
    list: (profileId, limit) => {
      listCalls.push([profileId, limit]);
      return Promise.resolve(queue.shift() ?? { data: [], error: null });
    },
    remove: (bucket, paths) => {
      removeCalls.push([bucket, [...paths]]);
      const own = script.perBucket?.[bucket];
      if (own) return Promise.resolve(own);
      if (typeof script.remove === 'function') return script.remove();
      return Promise.resolve(script.remove ?? { error: null });
    },
  };
  return { p, listCalls, removeCalls };
};

const row = (bucket_id: string, name: string) => ({ bucket_id, name });

Deno.test('a listing that comes back empty is the clean end — no remove, exhausted', async () => {
  const { p, listCalls, removeCalls } = ports({ list: [{ data: [], error: null }] });
  const s = await sweepMemberStorage(p, 'user-1');
  assertEquals(s, { removed: 0, rounds: 1, exhausted: true, failed: false });
  assertEquals(removeCalls, []);
  // the member id and the batch ceiling are what the RPC is asked for
  assertEquals(listCalls, [['user-1', REMOVE_BATCH]]);
  assertEquals(REMOVE_BATCH, 1000); // storage-api's ceiling AND PostgREST's max_rows
});

Deno.test('a null manifest is an empty one, not a malformed one', async () => {
  // PostgREST answers a zero-row RPC with data: null, and that is the ordinary case for a
  // member who uploaded nothing. It must not read as a failure.
  const { p } = ports({ list: [{ data: null, error: null }] });
  assertEquals(await sweepMemberStorage(p, 'user-1'), {
    removed: 0,
    rounds: 1,
    exhausted: true,
    failed: false,
  });
});

Deno.test(
  'ONE remove per bucket, grouped — then a second round proves the folder drained',
  async () => {
    const { p, removeCalls } = ports({
      list: [
        {
          data: [
            row('avatars', 'user-1/user-1.jpg'),
            row('chat-media', 'user-1/conv-1/m-1.jpg'),
            row('chat-media', 'user-1/conv-1/m-2.jpg'),
            row('post-media', 'user-1/post-1/0.jpg'),
          ],
          error: null,
        },
        { data: [], error: null },
      ],
    });
    const s = await sweepMemberStorage(p, 'user-1');

    assertEquals(removeCalls, [
      ['avatars', ['user-1/user-1.jpg']],
      ['chat-media', ['user-1/conv-1/m-1.jpg', 'user-1/conv-1/m-2.jpg']],
      ['post-media', ['user-1/post-1/0.jpg']],
    ]);
    // four keys removed, two rounds: the round that removed and the round that found nothing.
    assertEquals(s, { removed: 4, rounds: 2, exhausted: true, failed: false });
  },
);

Deno.test('the manifest read failing is a failure, never an empty folder', async () => {
  const { p, removeCalls } = ports({ list: [{ data: null, error: { message: 'db down' } }] });
  const s = await sweepMemberStorage(p, 'user-1');
  assertEquals(s, { removed: 0, rounds: 1, exhausted: false, failed: true });
  assertEquals(removeCalls, []);
});

Deno.test('a REJECTED manifest read is caught and counted the same way', async () => {
  // PostgREST reports a dead dependency both ways (#179); a caller that handles only the
  // resolved shape lets the other one through as an unhandled rejection.
  const p: SweepPorts = {
    list: () => Promise.reject(new Error('transport down')),
    remove: () => Promise.resolve({ error: null }),
  };
  assertEquals(await sweepMemberStorage(p, 'user-1'), {
    removed: 0,
    rounds: 1,
    exhausted: false,
    failed: true,
  });
});

Deno.test('malformed manifest rows are a failure, not "nothing to remove"', async () => {
  // A shape change in the RPC and a member with no objects reach this line with the same
  // "no paths" outcome. Only one of them is a swept member.
  const { p, removeCalls } = ports({
    list: [{ data: [{ bucket: 'avatars', path: 'user-1/user-1.jpg' }], error: null }],
  });
  const s = await sweepMemberStorage(p, 'user-1');
  assertEquals(s, { removed: 0, rounds: 1, exhausted: false, failed: true });
  assertEquals(removeCalls, []);
});

Deno.test(
  'an empty key is malformed too — remove([""]) would delete nothing, quietly',
  async () => {
    const { p } = ports({ list: [{ data: [row('avatars', '')], error: null }] });
    assertEquals((await sweepMemberStorage(p, 'user-1')).failed, true);
  },
);

Deno.test("a remove resolving { error } is recorded — 'failed', and the loop stops", async () => {
  const { p, listCalls } = ports({
    list: [{ data: [row('avatars', 'user-1/user-1.jpg')], error: null }],
    remove: { error: { message: 'bucket gone' } },
  });
  const s = await sweepMemberStorage(p, 'user-1');
  assertEquals(s, { removed: 0, rounds: 1, exhausted: false, failed: true });
  // A dead Storage API does not recover inside one invocation: no second listing.
  assertEquals(listCalls.length, 1);
});

Deno.test('a REJECTED remove is caught and counted the same way', async () => {
  const { p } = ports({
    list: [{ data: [row('avatars', 'user-1/user-1.jpg')], error: null }],
    remove: () => Promise.reject(new Error('storage down')),
  });
  assertEquals(await sweepMemberStorage(p, 'user-1'), {
    removed: 0,
    rounds: 1,
    exhausted: false,
    failed: true,
  });
});

Deno.test('one dead bucket does not abandon the live ones in the same round', async () => {
  const { p, removeCalls } = ports({
    list: [
      {
        data: [
          row('avatars', 'user-1/user-1.jpg'),
          row('chat-media', 'user-1/conv-1/m-1.jpg'),
          row('moments', 'user-1/mom-1.jpg'),
        ],
        error: null,
      },
    ],
    perBucket: { 'chat-media': { error: { message: 'bucket gone' } } },
  });
  const s = await sweepMemberStorage(p, 'user-1');

  assertEquals(
    removeCalls.map(([b]) => b),
    ['avatars', 'chat-media', 'moments'],
  );
  // the two that worked are counted; the run is still 'failed' because one bucket kept its bytes
  assertEquals(s, { removed: 2, rounds: 1, exhausted: false, failed: true });
});

Deno.test('a folder that never drains burns the round budget and is NOT exhausted', async () => {
  // The Storage API answering without an error is not proof a byte is gone. Re-listing is the
  // only check available, and a key that keeps coming back must not report as a clean sweep.
  const { p, listCalls, removeCalls } = ports({
    list: Array.from({ length: MAX_ROUNDS + 2 }, () => ({
      data: [row('avatars', 'user-1/user-1.jpg')],
      error: null,
    })),
  });
  const s = await sweepMemberStorage(p, 'user-1');

  assertEquals(s.rounds, MAX_ROUNDS);
  assertEquals(s.exhausted, false); // ← what the caller degrades on
  assertEquals(s.failed, false); // nothing reported an error; it simply did not converge
  assertEquals(listCalls.length, MAX_ROUNDS);
  assertEquals(removeCalls.length, MAX_ROUNDS);
  assert(MAX_ROUNDS >= 2, 'a single-round budget could never observe a drained folder');
});

Deno.test('rounds converge: each round re-lists what is LEFT, never a cursor', async () => {
  // Removed objects leave storage.objects, so a keyset cursor would skip every other batch.
  const { p, listCalls } = ports({
    list: [
      { data: [row('moments', 'user-1/a.jpg'), row('moments', 'user-1/b.jpg')], error: null },
      { data: [row('moments', 'user-1/b.jpg')], error: null },
      { data: [], error: null },
    ],
  });
  const s = await sweepMemberStorage(p, 'user-1');
  assertEquals(s, { removed: 3, rounds: 3, exhausted: true, failed: false });
  // every listing asks for the same thing — no cursor, no offset
  assertEquals(new Set(listCalls.map(([, limit]) => limit)), new Set([REMOVE_BATCH]));
});
