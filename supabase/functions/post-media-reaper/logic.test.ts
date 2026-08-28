import { assert, assertEquals, assertStrictEquals } from 'jsr:@std/assert@1';
import { reapBucket } from '../_shared/reap.ts';
import {
  MAX_ROUNDS,
  POST_MEDIA_BUCKET,
  REMOVE_BATCH,
  reapPostMedia,
  type ReaperPorts,
} from './logic.ts';

// The loop itself is asserted once, in story-segment-reaper/logic.test.ts, against the module
// this one re-exports — duplicating those fourteen cases here would be two copies of the same
// contract, which is exactly what moving the loop into _shared/reap.ts removed. What is left
// to assert is what is NEW and what could realistically be typed wrong:
//
//   • the bucket this reaper deletes from, spelled the way the bucket actually is;
//   • that `reapPostMedia` IS the shared loop and not a second implementation that could drift;
//   • the wiring in index.ts — the RPC name and the bucket constant it hands the two ports.
//     Nothing else executes index.ts (it calls Deno.serve at module scope), so a mistyped
//     `post_media_reap_candidate` would otherwise first surface as a 404 from PostgREST on the
//     nightly cron, in pg_net's response table, which nobody is watching.
//
// Plus one end-to-end pass through this module's own export, so the file is not purely
// structural.

Deno.test('the bucket is post-media, the name storage and every policy use', () => {
  assertEquals(POST_MEDIA_BUCKET, 'post-media');
});

Deno.test('reapPostMedia is the shared loop, not a second copy of it', () => {
  assertStrictEquals(reapPostMedia, reapBucket);
  assertEquals(REMOVE_BATCH, 1000);
  assertEquals(MAX_ROUNDS, 5);
});

Deno.test('index.ts wires the ports to the RPC and bucket this reaper declares', () => {
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url));
  assert(
    src.includes("db.rpc('post_media_reap_candidates'"),
    'index.ts must list through post_media_reap_candidates — the RPC 20260828103400 creates',
  );
  assert(
    src.includes('db.storage.from(POST_MEDIA_BUCKET).remove'),
    'index.ts must delete through the Storage API, never a storage.objects row delete',
  );
  assert(
    !/from\s*\(\s*['"]/.test(src),
    'index.ts must take the bucket from POST_MEDIA_BUCKET, never a second string literal',
  );
});

Deno.test('a full pass: lists, removes, then reports the batch drained', async () => {
  const listed = [{ name: 'u1/p1/1.jpg' }, { name: 'u1/p1/0-thumb.jpg' }];
  const removeCalls: string[][] = [];
  let listCall = 0;
  const ports: ReaperPorts = {
    listCandidates: () => {
      listCall++;
      // Round 1 hands back the orphans; round 2 finds the set drained, which is what ends the
      // pass before MAX_ROUNDS.
      return Promise.resolve({ data: listCall === 1 ? listed : [], error: null });
    },
    remove: (paths) => {
      removeCalls.push(paths);
      return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
    },
  };

  const res = await reapPostMedia(ports);

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { reaped: 2, unremoved: 0, rounds: 2, exhausted: true });
  // Both reference columns are represented: a superseded tail image and an orphaned poster.
  assertEquals(removeCalls, [['u1/p1/1.jpg', 'u1/p1/0-thumb.jpg']]);
});
