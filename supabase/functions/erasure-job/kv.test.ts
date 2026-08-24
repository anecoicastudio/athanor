// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
// Needs --allow-env (cloudflareKvFromEnv reads the CF_* trio); deliberately NOT --allow-net,
// which CI does not grant: every HTTP call here goes through an injected fetch.
//
// What these pin, beyond "it calls the API": the sweep reaches DEAD build prefixes, not just
// the live one (docs/RELEASE-RUNBOOK.md §7.4 — an unroutable copy is not an erased copy), and
// no failure mode of the Cloudflare API is allowed to look like a clean run.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  cloudflareKvFromEnv,
  KV_CACHE_PREFIX,
  makeCloudflareKv,
  ogCardPaths,
  sha256Hex,
} from './kv.ts';

const CFG = { token: 'test-token', accountId: 'acct-1', namespaceId: 'ns-1' };
const BASE = `https://api.cloudflare.com/client/v4/accounts/acct-1/storage/kv/namespaces/ns-1`;

type Req = { url: string; method: string };

/**
 * A fake Cloudflare KV. `pages` are the successive list responses; every DELETE succeeds
 * unless `deleteStatus` says otherwise.
 */
function fakeCf(
  pages: { names: string[]; cursor?: string }[],
  opts: { listStatus?: number; deleteStatus?: number; listSuccessFalse?: boolean } = {},
) {
  const seen: Req[] = [];
  let page = 0;
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    seen.push({ url, method });
    if (method === 'DELETE') {
      const status = opts.deleteStatus ?? 200;
      return Promise.resolve(new Response('{}', { status }));
    }
    if (opts.listStatus && opts.listStatus !== 200) {
      return Promise.resolve(new Response('nope', { status: opts.listStatus }));
    }
    const p = pages[page++] ?? { names: [] };
    return Promise.resolve(
      Response.json({
        success: !opts.listSuccessFalse,
        result: p.names.map((name) => ({ name })),
        result_info: { cursor: p.cursor ?? '' },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const deletedKeys = (seen: Req[]) =>
  seen
    .filter((r) => r.method === 'DELETE')
    .map((r) => decodeURIComponent(r.url.slice(`${BASE}/values/`.length)));

Deno.test('ogCardPaths covers the page AND the card, with the @ in the path', () => {
  // Not just the OG card: the profile HTML carries the same photo and dream quote (§7.4).
  assertEquals(ogCardPaths('luna_dev'), ['/@luna_dev', '/@luna_dev/opengraph-image']);
});

Deno.test('sha256Hex matches the digest OpenNext puts in the key', async () => {
  // sha256("/@luna_dev/opengraph-image") — the shape docs/RELEASE-RUNBOOK.md §7.4 computes
  // with `printf '%s' "/@handle/opengraph-image" | shasum -a 256`.
  const hex = await sha256Hex('/@luna_dev/opengraph-image');
  assertEquals(hex.length, 64);
  assert(/^[0-9a-f]{64}$/.test(hex));
  assertEquals(
    await sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

Deno.test('purges the subject under EVERY build prefix, leaving other keys alone', async () => {
  const [pageHash, cardHash] = await Promise.all([
    sha256Hex('/@luna_dev'),
    sha256Hex('/@luna_dev/opengraph-image'),
  ]);
  const otherHash = await sha256Hex('/@someone_else');

  // Two build prefixes: one live, one dead. Both hold the subject's two entries.
  const names = [
    `${KV_CACHE_PREFIX}/buildLIVE/${pageHash}.cache`,
    `${KV_CACHE_PREFIX}/buildLIVE/${cardHash}.cache`,
    `${KV_CACHE_PREFIX}/buildDEAD/${pageHash}.cache`,
    `${KV_CACHE_PREFIX}/buildDEAD/${cardHash}.cache`,
    `${KV_CACHE_PREFIX}/buildLIVE/${otherHash}.cache`,
  ];
  const { fetchImpl, seen } = fakeCf([{ names }]);

  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));

  assertEquals(res.error, undefined);
  assertEquals(res.deleted, 4);
  assertEquals(res.scanned, 5);
  assertEquals(deletedKeys(seen).sort(), names.slice(0, 4).sort());

  const list = seen.find((r) => r.method === 'GET');
  assert(list);
  const q = new URL(list.url).searchParams;
  assertEquals(q.get('prefix'), `${KV_CACHE_PREFIX}/`);
  assertEquals(q.get('limit'), '1000');
});

Deno.test('follows the list cursor across pages', async () => {
  const cardHash = await sha256Hex('/@luna_dev/opengraph-image');
  const { fetchImpl, seen } = fakeCf([
    { names: [`${KV_CACHE_PREFIX}/b1/deadbeef.cache`], cursor: 'CURSOR-2' },
    { names: [`${KV_CACHE_PREFIX}/b2/${cardHash}.cache`] },
  ]);

  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(['/@luna_dev/opengraph-image']);

  assertEquals(res.deleted, 1);
  assertEquals(res.scanned, 2);
  const lists = seen.filter((r) => r.method === 'GET');
  assertEquals(lists.length, 2);
  assertEquals(new URL(lists[0].url).searchParams.get('cursor'), null);
  assertEquals(new URL(lists[1].url).searchParams.get('cursor'), 'CURSOR-2');
});

Deno.test('no matching key is a clean sweep, not a failure', async () => {
  // The ordinary case: #335 caps prerendering, so most members never had a cached entry.
  const { fetchImpl, seen } = fakeCf([{ names: [`${KV_CACHE_PREFIX}/b1/deadbeef.cache`] }]);
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  assertEquals(res, { deleted: 0, scanned: 1 });
  assertEquals(deletedKeys(seen), []);
});

Deno.test('a failed list is reported, never reported as clean', async () => {
  const { fetchImpl } = fakeCf([], { listStatus: 403 });
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  assert(res.error instanceof Error);
  assertEquals(res.error.message, 'KV list failed: 403');
  assertEquals(res.deleted, 0);
});

Deno.test('success=false is reported even on a 200', async () => {
  const { fetchImpl } = fakeCf([{ names: [] }], { listSuccessFalse: true });
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  assert(res.error instanceof Error);
  assertEquals(res.error.message, 'KV list returned success=false');
});

Deno.test('a rejected fetch is reported, not thrown', async () => {
  const fetchImpl = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  assert(res.error instanceof Error);
  assertEquals(res.error.message, 'network down');
});

Deno.test('a 404 on delete is the erased state, not an error', async () => {
  const cardHash = await sha256Hex('/@luna_dev/opengraph-image');
  const { fetchImpl } = fakeCf([{ names: [`${KV_CACHE_PREFIX}/b1/${cardHash}.cache`] }], {
    deleteStatus: 404,
  });
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(['/@luna_dev/opengraph-image']);
  assertEquals(res, { deleted: 0, scanned: 1 });
});

Deno.test('a failed delete keeps sweeping and still reports the failure', async () => {
  const [pageHash, cardHash] = await Promise.all([
    sha256Hex('/@luna_dev'),
    sha256Hex('/@luna_dev/opengraph-image'),
  ]);
  const { fetchImpl, seen } = fakeCf(
    [
      {
        names: [
          `${KV_CACHE_PREFIX}/b1/${pageHash}.cache`,
          `${KV_CACHE_PREFIX}/b1/${cardHash}.cache`,
        ],
      },
    ],
    { deleteStatus: 500 },
  );
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  // Both attempted — erasure removes as much as it can — and the failure survives to the caller.
  assertEquals(deletedKeys(seen).length, 2);
  assert(res.error instanceof Error);
  assertEquals(res.error.message, 'KV delete failed: 500');
});

Deno.test('an unbounded listing stops and reports rather than looping forever', async () => {
  // Every page hands back a fresh cursor: without the page cap this never returns.
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'DELETE') return Promise.resolve(new Response('{}'));
    return Promise.resolve(
      Response.json({
        success: true,
        result: [{ name: 'x/y/z.cache' }],
        result_info: { cursor: 'more' },
      }),
    );
  }) as unknown as typeof fetch;
  const res = await makeCloudflareKv(CFG, fetchImpl).purgePaths(ogCardPaths('luna_dev'));
  assert(res.error instanceof Error);
  assert(res.error.message.includes('sweep incomplete'));
});

Deno.test('no paths means no API call at all', async () => {
  const { fetchImpl, seen } = fakeCf([{ names: [] }]);
  assertEquals(await makeCloudflareKv(CFG, fetchImpl).purgePaths([]), { deleted: 0, scanned: 0 });
  assertEquals(seen.length, 0);
});

Deno.test(
  'cloudflareKvFromEnv needs all three vars, and returns null — never a no-op client',
  () => {
    const NAMES = ['CF_KV_PURGE_TOKEN', 'CF_KV_ACCOUNT_ID', 'CF_KV_NAMESPACE_ID'] as const;
    const saved = NAMES.map((n) => [n, Deno.env.get(n)] as const);
    try {
      for (const n of NAMES) Deno.env.delete(n);
      assertEquals(cloudflareKvFromEnv(), null, 'nothing set');

      // Each partial combination is still null: a half-configured trio would purge the wrong
      // namespace, or nothing, while looking configured.
      for (const missing of NAMES) {
        for (const n of NAMES) Deno.env.set(n, 'value');
        Deno.env.delete(missing);
        assertEquals(cloudflareKvFromEnv(), null, `missing ${missing}`);
      }

      for (const n of NAMES) Deno.env.set(n, 'value');
      assert(cloudflareKvFromEnv() !== null, 'all three set');
    } finally {
      for (const [n, v] of saved) {
        if (v === undefined) Deno.env.delete(n);
        else Deno.env.set(n, v);
      }
    }
  },
);
