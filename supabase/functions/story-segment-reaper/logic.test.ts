import { assertEquals } from 'jsr:@std/assert@1';
import { MAX_ROUNDS, REMOVE_BATCH, reapStorySegments, type ReaperPorts } from './logic.ts';

// The reaper's whole contract is a loop over two ports: list the next batch of objects with
// no live-or-pinned descriptor (`story_segment_reap_candidates`, the SELECT policy's inverse
// with a grace margin — asserted in pgTAP 0126), then delete them through the Storage API
// (`storage.from('story-segments').remove`, never a `storage.objects` row delete — docs:
// "deleting the metadata doesn't remove the object in the underlying storage provider").
// What this file asserts is the loop's discipline: batch size is the API's ceiling, every
// round re-lists instead of paginating (removed objects vanish from the candidate set, so a
// cursor would skip), exhaustion means "nothing new listed" and never "a short list", a name
// the API left behind is counted once and not retried in the same run, a round that deletes
// nothing is not an error (a concurrent pass may have won), and a bounded number of rounds so
// one pass answers inside pg_net's timeout.

type Scripted = {
  lists?: ({ data?: unknown; error?: { message: string } | null } | 'full')[];
  removes?: { data?: { name: string }[] | null; error?: { message: string } | null }[];
};

const names = (n: number, prefix = 'u') =>
  Array.from({ length: n }, (_, i) => ({ name: `${prefix}/${String(i).padStart(5, '0')}.mp4` }));

function makePorts(s: Scripted = {}) {
  const listCalls: number[] = [];
  const removeCalls: string[][] = [];
  const lists = [...(s.lists ?? [])];
  const removes = [...(s.removes ?? [])];
  const ports: ReaperPorts = {
    listCandidates: (limit) => {
      listCalls.push(limit);
      const next = lists.shift();
      // 'full' = a fresh, distinct full batch — what a real backlog looks like round after
      // round once the previous batch is gone.
      if (next === 'full') {
        return Promise.resolve({ data: names(limit, `r${listCalls.length}`), error: null });
      }
      return Promise.resolve({ data: next?.data ?? [], error: next?.error ?? null });
    },
    remove: (paths) => {
      removeCalls.push(paths);
      const next = removes.shift();
      // Default: the API reports every requested path deleted.
      if (!next) return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
      return Promise.resolve({
        data: next.data === undefined ? paths.map((name) => ({ name })) : next.data,
        error: next.error ?? null,
      });
    },
  };
  return { ports, listCalls, removeCalls };
}

Deno.test('nothing to reap → 200, exhausted, and remove() is never called', async () => {
  const { ports, listCalls, removeCalls } = makePorts({ lists: [{ data: [] }] });
  const res = await reapStorySegments(ports);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { reaped: 0, unremoved: 0, rounds: 1, exhausted: true });
  assertEquals(listCalls, [REMOVE_BATCH]);
  assertEquals(removeCalls, []);
});

Deno.test(
  'a partial batch is removed with exactly the listed paths, then an empty list ends the run',
  async () => {
    const listed = names(3);
    const { ports, removeCalls } = makePorts({ lists: [{ data: listed }, { data: [] }] });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { reaped: 3, unremoved: 0, rounds: 2, exhausted: true });
    assertEquals(removeCalls, [listed.map((r) => r.name)]);
  },
);

Deno.test(
  'full → partial → empty: every round re-lists, the empty list is what ends it',
  async () => {
    const { ports, listCalls, removeCalls } = makePorts({
      lists: ['full', { data: names(7, 'v') }, { data: [] }],
    });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      reaped: REMOVE_BATCH + 7,
      unremoved: 0,
      rounds: 3,
      exhausted: true,
    });
    assertEquals(listCalls, [REMOVE_BATCH, REMOVE_BATCH, REMOVE_BATCH]);
    assertEquals(removeCalls.length, 2);
    assertEquals(removeCalls[0].length, REMOVE_BATCH);
  },
);

Deno.test(
  'a short list is NOT exhaustion (PostgREST max-rows can truncate below the batch)',
  async () => {
    // Operator lowers the API's max-rows to 500: every RPC answer is short on a healthy
    // backlog. Inferring "drained" from the length would reap 500 a night and report success.
    const { ports, removeCalls } = makePorts({
      lists: [{ data: names(500, 'a') }, { data: names(500, 'b') }, { data: [] }],
    });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { reaped: 1000, unremoved: 0, rounds: 3, exhausted: true });
    assertEquals(removeCalls.length, 2);
  },
);

Deno.test('the batch handed to remove() never exceeds the Storage API ceiling', async () => {
  // A misbehaving RPC returning more rows than asked must not produce an oversized remove().
  const { ports, removeCalls } = makePorts({ lists: [{ data: names(REMOVE_BATCH + 50) }] });
  const res = await reapStorySegments(ports);
  assertEquals(res.status, 200);
  assertEquals(removeCalls.length, 1);
  assertEquals(removeCalls[0].length, REMOVE_BATCH);
});

Deno.test('duplicate names from the RPC are collapsed before remove()', async () => {
  const { ports, removeCalls } = makePorts({
    lists: [{ data: [{ name: 'a/x.mp4' }, { name: 'a/x.mp4' }, { name: 'a/y.jpg' }] }],
  });
  await reapStorySegments(ports);
  assertEquals(removeCalls, [['a/x.mp4', 'a/y.jpg']]);
});

Deno.test('a list error → 500 with nothing removed', async () => {
  const { ports, removeCalls } = makePorts({ lists: [{ error: { message: 'boom' } }] });
  const res = await reapStorySegments(ports);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), {
    reaped: 0,
    unremoved: 0,
    rounds: 1,
    exhausted: false,
    error: 'list: boom',
  });
  assertEquals(removeCalls, []);
});

Deno.test('malformed RPC rows → 500, and remove() is not called with garbage', async () => {
  const { ports, removeCalls } = makePorts({
    lists: [{ data: [{ name: 'ok/x.mp4' }, { nope: 1 }] }],
  });
  const res = await reapStorySegments(ports);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'list: malformed rows');
  assertEquals(removeCalls, []);
});

Deno.test('a remove error → 500 carrying what was already reaped', async () => {
  const { ports } = makePorts({
    lists: ['full', { data: names(2, 'w') }],
    removes: [{}, { error: { message: 'storage down' } }],
  });
  const res = await reapStorySegments(ports);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), {
    reaped: REMOVE_BATCH,
    unremoved: 0,
    rounds: 2,
    exhausted: false,
    error: 'remove: storage down',
  });
});

Deno.test(
  'a round that deletes nothing is not an error: a concurrent pass may have won',
  async () => {
    // The operator invokes by hand while the 03:17 pass is mid-loop: both list the same oldest
    // batch, the other run deletes it, this run's remove() answers with nothing. Count it,
    // keep going; the next list says whether anything is left.
    const { ports, listCalls } = makePorts({
      lists: ['full', { data: [] }],
      removes: [{ data: [] }],
    });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      reaped: 0,
      unremoved: REMOVE_BATCH,
      rounds: 2,
      exhausted: true,
    });
    assertEquals(listCalls.length, 2);
  },
);

Deno.test(
  'a name the API left behind is counted once and not retried in the same run',
  async () => {
    // The RPC lists oldest-first, so a leftover heads the very next batch. Without the
    // attempted-set it would be handed to remove() and counted again every round.
    const listed = names(4, 'p');
    const { ports, removeCalls } = makePorts({
      lists: [{ data: listed }, { data: [listed[3]] }],
      removes: [{ data: listed.slice(0, 3) }],
    });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { reaped: 3, unremoved: 1, rounds: 2, exhausted: true });
    assertEquals(removeCalls.length, 1);
  },
);

Deno.test(
  'a bucket that never drains stops after MAX_ROUNDS, reporting not exhausted',
  async () => {
    const { ports, listCalls, removeCalls } = makePorts({
      lists: Array.from({ length: MAX_ROUNDS + 5 }, () => 'full' as const),
    });
    const res = await reapStorySegments(ports);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      reaped: MAX_ROUNDS * REMOVE_BATCH,
      unremoved: 0,
      rounds: MAX_ROUNDS,
      exhausted: false,
    });
    assertEquals(listCalls.length, MAX_ROUNDS);
    assertEquals(removeCalls.length, MAX_ROUNDS);
  },
);

Deno.test('REMOVE_BATCH is the documented Storage API ceiling', () => {
  // supabase.com/docs/guides/storage/management/delete-objects: remove() takes at most 1000.
  assertEquals(REMOVE_BATCH, 1000);
});

Deno.test('MAX_ROUNDS keeps one pass inside the 30 s pg_net gives the reply', () => {
  // invoke_story_segment_reaper() posts with timeout_milliseconds := 30000. A round is one
  // RPC plus one ≤ 1000-key Storage delete (1–5 s); five rounds answer in time, twenty would
  // not, and a timed-out reply is the only observable the runbook has. Raising this means
  // raising the timeout in a migration too.
  assertEquals(MAX_ROUNDS, 5);
});
