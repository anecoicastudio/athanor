// handle-rename-purge (#800) — internal service-role: purges the cached `/@handle` page and OG
// card from Cloudflare KV after a member renames their handle, or (#790) changes the identity,
// dream or zodiac visibility facet. Posted to by athanor.enqueue_handle_rename_purge() (AFTER
// UPDATE OF handle / OF visibility on profiles) through pg_net,
// with the key on the `apikey` header. Transport shell only — ./logic.ts decides, and the sweep
// is _shared/kv-purge.ts, the one erasure-job runs.
import { requireServiceRole } from '../_shared/auth.ts';
import { cloudflareKvFromEnv } from '../_shared/kv-purge.ts';
import { purgeRenamedHandle } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  // Reads CF_KV_PURGE_TOKEN / CF_KV_ACCOUNT_ID / CF_KV_NAMESPACE_ID behind the gate — the same
  // trio erasure-job reads, already set on both hosted projects (RELEASE-RUNBOOK §7.2).
  return purgeRenamedHandle(req, cloudflareKvFromEnv());
});
