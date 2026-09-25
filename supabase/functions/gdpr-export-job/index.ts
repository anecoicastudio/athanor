// gdpr-export-job (11 §3.9 8a) — service-role, nightly pg_cron over gdpr_export_jobs. Since #721
// the batch is taken by claim_export_jobs under a lease, so a pass torn down mid-run no longer
// strands its rows, and a job that cannot be served is filed 'failed' rather than looping.
// Assembles the member's archive (every EXPORT_SPEC section in ./logic.ts — profile through
// gdpr_erasure_requests — plus, since #784, the account email, their conversations in full with
// the other party by handle only, and copies of their own media), uploads it to the private
// `exports` bucket as `{uid}/{job}/archive.json` with the media beside it under `media/`, signs
// every file for the 7-day retention window, and sets status='ready' + download_url + expires_at;
// that update fires the gdprExport notification producer (20260813162227), which tells the
// member in-app. Each pass first REAPS: every `exports` object no live job protects and every
// row past its window go (#784 ruling 2; 20260925154710).
// Archive assembly is server-side and is NEVER bundled into the app build (09 §6).
// BYTES, not only keys, since #784 — for the member's OWN uploads (the six media buckets under
// their `{uid}/` prefix, gdpr_export_media). A chat image they RECEIVED stays a filename: it sits
// under the sender's prefix and is the sender's data. The copy is server-side (Storage API
// `copy` into `exports`), because an edge isolate's CPU budget cannot zip a video library; so
// the archive is a folder of files and a manifest (`media` in archive.json) rather than one zip.
// Transport shell only — the claim/assemble/upload loop lives in ./logic.ts (unit-tested);
// this file wires auth, the service-role client, the storage ports and the Auth email read.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { processExportJobs } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();
  const exportsBucket = () => db.storage.from('exports');

  return processExportJobs({
    db,
    storage: {
      upload: (path, body, opts) => exportsBucket().upload(path, body, opts),
      createSignedUrl: (path, ttl) => exportsBucket().createSignedUrl(path, ttl),
      createSignedUrls: (paths, ttl) => exportsBucket().createSignedUrls(paths, ttl),
      copyIn: (bucket, from, to) =>
        db.storage.from(bucket).copy(from, to, {
          destinationBucket: 'exports',
        }),
      remove: (paths) => exportsBucket().remove(paths),
    },
    getEmail: async (profileId) => {
      const { data, error } = await db.auth.admin.getUserById(profileId);
      return { email: data?.user?.email ?? null, error };
    },
  });
});
