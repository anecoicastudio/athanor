import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_m9_gdpr_export_erasure.sql · gdpr_export_jobs (06 §2.14),
// widened to four values by <ts>_gdpr_export_claim_lease.sql (#721).
// GATED: owner requests (status='requested'), backend job sets processing/ready + signed url.
// 'failed' is terminal and the backend's alone: an archive that cannot be produced (a section
// read errored, so a partial archive would be presented as complete) or can no longer be handed
// over (the 30-day expiry cap leaves no room for a signed link). The member's retry is a NEW
// 'requested' row, never a status write — the claim predicate does not reach a terminal row.
export const GDPR_EXPORT_STATUSES = ['requested', 'processing', 'ready', 'failed'] as const;
export const gdprExportStatus = z.enum(GDPR_EXPORT_STATUSES);
export type GdprExportStatus = z.infer<typeof gdprExportStatus>;

/**
 * Insert payload for BOTH owner-enqueued GDPR tables (gdpr_export_jobs and
 * gdpr_erasure_requests — same shape by design, m9_gdpr_export_erasure.sql): the owner
 * sends only their profile_id; status/url/timestamps are server-defaulted and RLS
 * WITH CHECK pins profile_id = auth.uid() and status = 'requested'.
 */
export const gdprRequestInsertSchema = z.object({ profile_id: z.string().uuid() });
export type GdprRequestInsert = z.infer<typeof gdprRequestInsertSchema>;

export const gdprExportJobSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  status: gdprExportStatus,
  download_url: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type GdprExportJob = z.infer<typeof gdprExportJobSchema>;
