// gdpr-export-job (11 §3.9 8a) — service-role, nightly pg_cron over gdpr_export_jobs status='requested'.
// Assembles the user's archive (profile, dreams, posts, moments, messages, consent, tickets/rsvps refs),
// uploads to the private `exports` bucket, signs a time-limited URL (72h — 10 §5 open decision), emails
// it, and sets status='ready' + download_url + expires_at. Archive assembly is server-side and is NEVER
// bundled into the app build (09 §6). DEPLOY-DEFERRED: not deployed this slice; pg_cron scheduled at deploy-time.
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
