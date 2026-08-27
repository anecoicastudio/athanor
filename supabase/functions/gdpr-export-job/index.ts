// gdpr-export-job (11 §3.9 8a) — service-role, nightly pg_cron over gdpr_export_jobs status='requested'.
// Assembles the user's archive (every EXPORT_SPEC section in ./logic.ts — profile through
// gdpr_erasure_requests), uploads to the private `exports` bucket, signs a time-limited URL
// (72h — 10 §5 open decision), and sets status='ready' + download_url + expires_at; that update
// fires the gdprExport notification producer (20260813162227), which tells the member in-app.
// Archive assembly is server-side and is NEVER bundled into the app build (09 §6).
// KEYS, NOT BYTES, and uniformly so — worth stating because #573 was filed believing otherwise.
// Every section is a `select('*')`, so each bucket's key columns ride along with their rows
// (`post_media.storage_path`, `moments.media_path`, `profiles.avatar_path`,
// `dream_candidacies.video_url`, `story_segments.storage_path`, `messages.media_url`). No bucket
// is privileged and none is skipped; what the archive does NOT contain is the media itself, for
// any bucket. Whether Art. 20 wants the bytes is an open product decision — adding them ends the
// single-JSON archive and makes the `exports` bucket's 100 MiB limit load-bearing.
// Transport shell only — the claim/assemble/upload loop lives in ./logic.ts (unit-tested);
// this file wires auth, the service-role client, and the `exports` bucket storage port.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { processExportJobs } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return processExportJobs({
    db,
    storage: {
      upload: (path, body, opts) => db.storage.from('exports').upload(path, body, opts),
      createSignedUrl: (path, ttl) => db.storage.from('exports').createSignedUrl(path, ttl),
    },
  });
});
