/**
 * handle-rename-purge (#800) — drops the cached public page of a handle a member renamed away
 * from, or whose visibility just changed what that page may show (#790).
 *
 * apps/web caches `/@handle` and its OG card in the OpenNext KV incremental cache, and neither
 * a rename nor a deploy removes them (docs/RELEASE-RUNBOOK.md §7.4), so without this the old
 * address kept serving the member's photo, name and dream quote — and, once someone else
 * claimed the handle, served them under that person's address. Ruled on #800 (2026-09-25):
 * purge on rename, keep no history of former handles. The sweep is `_shared/kv-purge.ts`, the
 * same one erasure-job runs; this only decides which paths and what the outcome answers.
 *
 * Called by `athanor.enqueue_handle_rename_purge()` through pg_net, from two triggers on
 * profiles: AFTER UPDATE OF handle (the handle a member left) and, since #790, AFTER UPDATE OF
 * visibility when the identity, dream or zodiac facet changes (the live handle — a switch to
 * «Membri» must take the page and its preview image down now, not at the next deploy). Both
 * send the same `{handle}` body and need the same sweep. pg_net keeps nothing but the
 * response, so the status code is the only record a purge ever leaves: an unconfigured
 * project or an incomplete sweep must never answer 200.
 */
import { z } from 'zod';
import { type KvPurger, ogCardPaths } from '../_shared/kv-purge.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * The DB CHECK on profiles.handle (^[a-z0-9_]{3,30}$). The trigger only ever sends a value
 * that passed it; re-checking here keeps anything else from becoming a hashed cache key.
 */
const bodySchema = z.object({ handle: z.string().regex(/^[a-z0-9_]{3,30}$/) });

export async function purgeRenamedHandle(req: Request, kv: KvPurger | null): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error('invalid body', 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return error('invalid body', 400);

  if (!kv) return json({ error: 'kv purge not configured', configured: false }, 503);

  const result = await kv.purgePaths(ogCardPaths(parsed.data.handle));
  if (result.error !== undefined) {
    // No handle in the log line: it names a member, and the response already carries the counts.
    console.error('handle-rename-purge: sweep incomplete', String(result.error));
    return json(
      { error: 'kv purge incomplete', deleted: result.deleted, scanned: result.scanned },
      502,
    );
  }
  return json({ deleted: result.deleted, scanned: result.scanned });
}
