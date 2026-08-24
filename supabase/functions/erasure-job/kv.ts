// Cloudflare Workers KV purge of an erased member's cached public web pages (#515 item 3).
//
// apps/web serves /@handle and its OG card through OpenNext's KV incremental cache
// (apps/web/open-next.config.ts). Every entry is keyed
//   incremental-cache/<BUILD_ID>/<sha256hex(path)>.cache
// (@opennextjs/cloudflare `computeCacheKey`; docs/RELEASE-RUNBOOK.md §7.4). Two facts make
// this an erasure problem and not a cache-invalidation one:
//   - BUILD_ID rotates on every build and populate-cache never lists and never deletes, so a
//     deploy STRANDS the previous build's entries under a dead prefix instead of replacing them;
//   - the cache writes no TTL and nothing sweeps old prefixes.
// A stranded entry is unroutable but still readable BY KEY, indefinitely, and it holds the
// member's photo, display name and dream quote. §7.4 recorded exactly that against production:
// an orphan under a dead prefix still returned the full prerendered profile page for a handle
// that no longer existed in the database. So this sweeps EVERY build prefix, not just the live
// one — an unroutable copy is not an erased copy.
//
// The credentials are third-party, so they are read with Deno.env.get directly: _shared/keys.ts
// resolves the platform-injected Supabase key JSON (rule 8) and knows nothing about Cloudflare.

const CF_API = 'https://api.cloudflare.com/client/v4';

/**
 * OpenNext's default cache prefix. apps/web sets no NEXT_INC_CACHE_KV_PREFIX
 * (apps/web/wrangler.jsonc), so every entry lives under this one.
 */
export const KV_CACHE_PREFIX = 'incremental-cache';

/** The API caps a list page at 1000 keys; MAX_LIST_PAGES bounds the whole sweep. */
const LIST_PAGE_LIMIT = 1000;
const MAX_LIST_PAGES = 100;

export type KvPurgeResult = {
  /** keys actually deleted — 0 is the ordinary outcome, see purgePaths */
  deleted: number;
  /** keys examined, across every build prefix */
  scanned: number;
  /** set when the sweep could not complete; the caller records it, never swallows it */
  error?: unknown;
};

/** The KV surface the erasure job needs. `null` at the call site means "not configured". */
export type ErasureKv = {
  purgePaths: (paths: string[]) => Promise<KvPurgeResult>;
};

/**
 * The public web paths that render an erased subject.
 *
 * BOTH, not just the card: apps/web/app/[handle]/page.tsx caches the prerendered profile HTML
 * and apps/web/app/[handle]/opengraph-image.tsx caches the rendered PNG, and each carries the
 * member's photo, display name and dream quote. §7.4 names the pair ("the stranded PNG and
 * page HTML"); #515's Done-when says only "OG cards", which would leave the HTML readable.
 *
 * The `@` is part of the URL path — lib/handle-static-params.ts emits `@${handle}` as the
 * segment and lib/resolve-handle.ts rejects a segment without it — so it is inside the hash.
 */
export function ogCardPaths(handle: string): string[] {
  return [`/@${handle}`, `/@${handle}/opengraph-image`];
}

/** Lowercase hex SHA-256 — the digest `computeCacheKey` puts in the key. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type CfConfig = { token: string; accountId: string; namespaceId: string };

type CfListResponse = {
  success?: boolean;
  result?: { name?: string }[];
  result_info?: { cursor?: string };
};

/**
 * Reads the Cloudflare trio from edge-function env, or returns null.
 *
 * Null is a state the caller reports, never a silent no-op (#468 and #492 are this repo's scar
 * tissue for unconfigured→skip). All three or none: a token without a namespace can purge
 * nothing, and a half-configured trio would purge the wrong namespace.
 */
export function cloudflareKvFromEnv(): ErasureKv | null {
  const token = Deno.env.get('CF_KV_PURGE_TOKEN');
  const accountId = Deno.env.get('CF_KV_ACCOUNT_ID');
  const namespaceId = Deno.env.get('CF_KV_NAMESPACE_ID');
  if (!token || !accountId || !namespaceId) return null;
  return makeCloudflareKv({ token, accountId, namespaceId });
}

/** fetchImpl is injected: CI runs `deno test` without --allow-net, so the tests use a fake. */
export function makeCloudflareKv(cfg: CfConfig, fetchImpl: typeof fetch = fetch): ErasureKv {
  const base = `${CF_API}/accounts/${cfg.accountId}/storage/kv/namespaces/${cfg.namespaceId}`;
  const headers = { authorization: `Bearer ${cfg.token}` };

  return {
    /**
     * Deletes every key in the namespace whose hash matches one of `paths`, under any build
     * prefix. `deleted: 0` is the ordinary result and NOT an error: #335 caps prerendering to
     * PRERENDER_HANDLE_LIMIT handles, so most members never had a cached card at all.
     */
    async purgePaths(paths: string[]): Promise<KvPurgeResult> {
      if (paths.length === 0) return { deleted: 0, scanned: 0 };

      // BUILD_ID sits BETWEEN the prefix and the hash, so the hash is a suffix match: one
      // listing of the whole prefix catches the live build and every dead one at once,
      // without having to know which BUILD_IDs ever existed.
      const suffixes = await Promise.all(paths.map(async (p) => `/${await sha256Hex(p)}.cache`));

      let deleted = 0;
      let scanned = 0;
      let cursor = '';
      // A failed DELETE does not abort the sweep — erasure removes as much as it can and then
      // reports. A failed LIST does abort: without its cursor there is no rest of the sweep.
      let deleteError: unknown;

      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const url = new URL(`${base}/keys`);
        url.searchParams.set('prefix', `${KV_CACHE_PREFIX}/`);
        url.searchParams.set('limit', String(LIST_PAGE_LIMIT));
        if (cursor) url.searchParams.set('cursor', cursor);

        let body: CfListResponse;
        try {
          const res = await fetchImpl(url.toString(), { headers });
          if (!res.ok) {
            return { deleted, scanned, error: new Error(`KV list failed: ${res.status}`) };
          }
          body = (await res.json()) as CfListResponse;
        } catch (e) {
          return { deleted, scanned, error: e };
        }
        if (body.success === false) {
          return { deleted, scanned, error: new Error('KV list returned success=false') };
        }

        const names = (body.result ?? []).map((k) => k.name).filter((n): n is string => !!n);
        scanned += names.length;

        for (const name of names) {
          if (!suffixes.some((s) => name.endsWith(s))) continue;
          try {
            const res = await fetchImpl(`${base}/values/${encodeURIComponent(name)}`, {
              method: 'DELETE',
              headers,
            });
            // 404 is the state we wanted, reached by someone else — not a failure.
            if (res.ok) deleted++;
            else if (res.status !== 404) {
              deleteError ??= new Error(`KV delete failed: ${res.status}`);
            }
          } catch (e) {
            deleteError ??= e;
          }
        }

        cursor = body.result_info?.cursor ?? '';
        // Cloudflare ends a listing with an empty cursor; an empty page ends it too, so a
        // response that omits the field entirely cannot spin this loop forever.
        if (!cursor || names.length === 0) {
          return deleteError ? { deleted, scanned, error: deleteError } : { deleted, scanned };
        }
      }

      // Never report a truncated sweep as a clean one — some of the subject's bytes may still
      // be in the namespace, and the caller has to be able to say so (no silent caps).
      return {
        deleted,
        scanned,
        error:
          deleteError ?? new Error(`KV list exceeded ${MAX_LIST_PAGES} pages; sweep incomplete`),
      };
    },
  };
}
