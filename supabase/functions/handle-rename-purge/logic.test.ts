// deno test supabase/functions/handle-rename-purge/ — runs in CI (edge job) and locally.
//
// The purge itself (every build prefix, failure never reported as clean) is pinned in
// _shared/kv-purge.test.ts, which this function shares with erasure-job. What is pinned here is
// the caller: which paths a rename asks for, what a malformed body does, and that neither an
// unconfigured project nor a failed sweep can answer 200 — pg_net keeps only the response, so
// the status is the one place a failed purge is ever visible (#800).
import { assertEquals } from 'jsr:@std/assert@1';
import type { KvPurger, KvPurgeResult } from '../_shared/kv-purge.ts';
import { purgeRenamedHandle } from './logic.ts';

function fakeKv(result: KvPurgeResult = { deleted: 2, scanned: 40 }) {
  const calls: string[][] = [];
  const kv: KvPurger = {
    purgePaths: (paths) => {
      calls.push(paths);
      return Promise.resolve(result);
    },
  };
  return { kv, calls };
}

const req = (body: unknown) =>
  new Request('http://local/handle-rename-purge', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

Deno.test('purges the old /@handle page AND its OG card — the pair erasure purges', async () => {
  const { kv, calls } = fakeKv();
  const res = await purgeRenamedHandle(req({ handle: 'luna_old' }), kv);
  assertEquals(res.status, 200);
  assertEquals(calls, [['/@luna_old', '/@luna_old/opengraph-image']]);
  assertEquals(await res.json(), { deleted: 2, scanned: 40 });
});

Deno.test('deleted: 0 is a clean outcome — most handles were never prerendered', async () => {
  const { kv } = fakeKv({ deleted: 0, scanned: 12 });
  const res = await purgeRenamedHandle(req({ handle: 'nobody_cached' }), kv);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: 0, scanned: 12 });
});

Deno.test('an unconfigured project answers 503, never a 200 that purged nothing', async () => {
  const res = await purgeRenamedHandle(req({ handle: 'luna_old' }), null);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: 'kv purge not configured', configured: false });
});

Deno.test('a failed or truncated sweep answers 502 with what it did manage', async () => {
  const { kv } = fakeKv({ deleted: 1, scanned: 1000, error: new Error('KV list failed: 500') });
  const res = await purgeRenamedHandle(req({ handle: 'luna_old' }), kv);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), {
    error: 'kv purge incomplete',
    deleted: 1,
    scanned: 1000,
  });
});

Deno.test('a body that is not a handle is refused before any KV call', async () => {
  for (const body of [
    {},
    { handle: '' },
    { handle: 'ab' },
    { handle: 'Upper_Case' },
    { handle: '../../etc' },
    { handle: 'x'.repeat(31) },
    { handle: 42 },
    'not json',
  ]) {
    const { kv, calls } = fakeKv();
    const res = await purgeRenamedHandle(req(body), kv);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(calls.length, 0, JSON.stringify(body));
  }
});
