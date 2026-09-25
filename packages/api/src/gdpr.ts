import {
  type GdprExportJob,
  gdprErasureRequestSchema,
  gdprExportJobSchema,
  gdprRequestInsertSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/**
 * The caller's most recent data-export job (RLS scopes to own; the profile_latest index orders it).
 * Returns null when the user has never requested an export. The app reads status off this:
 * requested|processing → "preparing"; ready → show the signed download_url; failed → say so and
 * offer the request button again (#721), which files a fresh row rather than reviving this one.
 */
export async function getLatestExportJob(client: AthanorClient): Promise<GdprExportJob | null> {
  const { data, error } = await client
    .from('gdpr_export_jobs')
    .select('id, profile_id, status, download_url, expires_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? gdprExportJobSchema.parse(data) : null;
}

/**
 * Request a data export. Inserts a row pinned to status='requested' (RLS WITH CHECK enforces
 * profile_id = auth.uid(), status='requested', null url/expiry, and since #721 a null claimed_at:
 * the lease stamp is not a client's to write). The gdpr-export-job (service_role) assembles the
 * archive and sets ready + the signed URL — never the client. This is also the retry after a
 * 'failed' or expired job: a new row, because a terminal one is never re-claimed.
 */
export async function requestExport(client: AthanorClient): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const profile_id = auth.user?.id;
  if (!profile_id) throw new Error('not authenticated');
  const payload = gdprRequestInsertSchema.parse({ profile_id });
  const { error } = await client.from('gdpr_export_jobs').insert(payload);
  // 23505 is the one open export job per member (#784, gdpr_export_jobs_one_open_per_profile) and
  // it is a SUCCESS here, as it is for erasure below: the member asked, and a job is already on
  // file for tonight's pass. Every other error still throws.
  if (error && error.code !== '23505') throw error;
}

/**
 * Request account erasure (the type-to-confirm flow gates this client-side). Inserts a request row;
 * the service-role erasure-job performs the cascade honoring legal retention (10 §5.4). The caller
 * is expected to sign out immediately after (store-compliant in-app deletion, 12 §3.3).
 */
export async function requestErasure(client: AthanorClient): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const profile_id = auth.user?.id;
  if (!profile_id) throw new Error('not authenticated');
  const payload = gdprRequestInsertSchema.parse({ profile_id });
  const { error } = await client.from('gdpr_erasure_requests').insert(payload);
  // 23505 is the one open request per member (#107, gdpr_erasure_requests_one_open_per_profile)
  // and it is a SUCCESS here: the member asked to be erased, and a request is already on file
  // waiting for tonight's job. Surfacing it would tell somebody who has just typed ELIMINA that
  // their deletion failed, which is both frightening and false. Every other error still throws.
  if (error && error.code !== '23505') throw error;
}

/**
 * Does the caller have an OPEN erasure request — any status but 'done'? (RLS scopes to own.)
 * #735: the erasure ban lives on auth.users, which the app cannot read, while athanor.is_active()
 * already denies every social write for as long as such a row exists. A second device signed in
 * before the tap reads this so it can say «in cancellazione» instead of failing each write with a
 * bare 42501.
 *
 * The row is still parsed (api.md: Zod at a query boundary), but a row that fails is reported
 * and COUNTED AS OPEN rather than withheld: the query's own predicate already proves openness,
 * and a status this build does not know yet — which is how 'retained' reached older builds — must
 * not make the banner disappear. The warning carries the row id, never member content.
 */
export async function hasOpenErasureRequest(client: AthanorClient): Promise<boolean> {
  const { data, error } = await client
    .from('gdpr_erasure_requests')
    .select('id, status')
    .neq('status', 'done')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (!gdprErasureRequestSchema.safeParse(data).success) {
    console.warn('[gdpr] erasure request row failed its schema', (data as { id?: unknown }).id);
  }
  return true;
}
