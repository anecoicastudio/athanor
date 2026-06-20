import { type GdprExportJob, gdprExportJobSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

/**
 * The caller's most recent data-export job (RLS scopes to own; the profile_latest index orders it).
 * Returns null when the user has never requested an export. The app reads status off this:
 * requested|processing → "preparing"; ready → show the signed download_url.
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
 * profile_id = auth.uid(), status='requested', null url/expiry). The gdpr-export-job (service_role)
 * assembles the archive and sets ready + the signed URL — never the client.
 */
export async function requestExport(client: AthanorClient): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const profile_id = auth.user?.id;
  if (!profile_id) throw new Error('not authenticated');
  const { error } = await client.from('gdpr_export_jobs').insert({ profile_id });
  if (error) throw error;
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
  const { error } = await client.from('gdpr_erasure_requests').insert({ profile_id });
  if (error) throw error;
}
