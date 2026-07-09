import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { json, error } from '../_shared/respond.ts';
import { stripMetadata } from './strip.ts';

/**
 * POST { bucket_id, name } → { stripped, ... } — server-side metadata strip (P2.2,
 * backend 10 §4.1a / 11 §3.9a). Invoked by the enqueue_media_process storage trigger
 * (pg_net, guarded GUCs — inert until P1.1 deploy). Downloads the object, strips
 * EXIF/GPS/XMP/IPTC (see ./strip.ts), re-uploads in place ONLY when bytes changed.
 *
 * Defense-in-depth backstop, therefore FAIL-OPEN: any error is logged and answered 200 —
 * the object stays exactly as the client uploaded it (the client already strips), and a
 * broken strip must never turn into a broken upload/feed. The re-upload itself re-fires
 * the storage trigger once; that second invocation finds changed=false and stops (strip
 * convergence — no loop).
 */

const BUCKETS = new Set(['post-media', 'moments', 'story-segments', 'candidacy-videos']);

// Edge isolate memory is ~256 MB and download+arrayBuffer holds ~2× the file. Above this
// the strip would OOM mid-flight; skip explicitly instead (fail-open backstop — the
// coverage hole for >100 MB candidacy videos is documented in PRODUCTION-READINESS P2.2).
const MAX_BYTES = 100 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  // Caller authorization: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  let bucketId: string;
  let name: string;
  try {
    const body = await req.json();
    bucketId = body?.bucket_id;
    name = body?.name;
  } catch {
    return error('invalid json', 400);
  }
  if (typeof bucketId !== 'string' || typeof name !== 'string' || name.trim() === '') {
    return error('bucket_id and name required', 400);
  }
  if (!BUCKETS.has(bucketId)) return error('bucket not allowed', 400);

  const db = supabaseAdmin();
  try {
    const { data: blob, error: dlErr } = await db.storage.from(bucketId).download(name);
    if (dlErr || !blob) {
      // Deleted before we ran, or transient — benign for a backstop.
      return json({ skipped: 'not_found', bucket_id: bucketId, name });
    }

    if (blob.size > MAX_BYTES) {
      console.warn('media-process skipped oversized object', bucketId, name, blob.size);
      return json({ skipped: 'too_large', bucket_id: bucketId, name, size: blob.size });
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { out, changed, kind } = stripMetadata(bytes);
    if (!changed) {
      // Clean already (client strip did its job) — also the loop-terminating path
      // for our own re-upload's trigger invocation.
      return json({ stripped: false, kind, bucket_id: bucketId, name });
    }

    const { error: upErr } = await db.storage.from(bucketId).upload(name, out, {
      contentType: blob.type || undefined,
      upsert: true,
    });
    if (upErr) {
      console.error('media-process upload failed', bucketId, name, upErr.message);
      return json({ error: 'upload failed', bucket_id: bucketId, name });
    }
    return json({ stripped: true, kind, bytes_before: bytes.length, bytes_after: out.length });
  } catch (e) {
    console.error('media-process failed', bucketId, name, e instanceof Error ? e.message : e);
    return json({ error: 'strip failed', bucket_id: bucketId, name });
  }
});
