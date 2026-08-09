import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';

/**
 * KV, not the static-assets cache and not the R2 default the docs suggest.
 *
 * The adapter's `static-assets-incremental-cache` looks like the free-plan answer
 * but is read-only by design — its `set()` only logs an error, and it documents
 * itself as being for apps that "do NOT want revalidation and ONLY want to serve
 * prerendered data". With `dynamicParams: true` on /[handle] every profile created
 * since the last build would then re-render on EVERY request, uncached, at ~3
 * Supabase subrequests each — the exact CPU path the 10 ms free budget punishes.
 * It also throws outright on the composable cache, foreclosing Next 16's
 * `use cache` later.
 *
 * KV is included on the free plan (100k reads/day) and lets an on-demand handle
 * render once and be served from cache after that.
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  /**
   * Required, not optional. `queue` defaults to `"dummy"`, whose `send()` throws
   * `FatalError("Dummy queue is not implemented")` — and OpenNext's only background
   * revalidation path is `revalidateIfRequired()` → `queue.send()`, which swallows
   * that error and logs "Failed to revalidate stale page". The build stays green and
   * nothing 500s, so the failure is silent.
   *
   * The KV cache writes no TTL of its own, so with the default queue a stale entry
   * would live until the next deploy. That is precisely the hazard `[handle]/page.tsx`
   * rejects `revalidate = false` for: a profile erased by the M9 job, or a member's
   * `visibility` flipped to private, would keep being served. The 5-minute TTL only
   * means anything with a real queue behind it.
   *
   * memoryQueue de-duplicates in-flight revalidations per isolate and needs the
   * WORKER_SELF_REFERENCE service binding declared in wrangler.jsonc.
   */
  queue: memoryQueue,
});

/*
 * Deliberately left at the "dummy" default: `tagCache`, so `revalidateTag` /
 * `revalidatePath` are silent no-ops. The only caller is the admin verdict action,
 * and every /admin route is force-dynamic, so nothing depends on it today. Wire a
 * real tag cache before using either API on a cached public route.
 */
