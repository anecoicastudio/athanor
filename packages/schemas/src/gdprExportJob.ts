import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_m9_gdpr_export_erasure.sql · gdpr_export_jobs (06 §2.14).
// GATED: owner requests (status='requested'), backend job sets processing/ready + signed url.
export const GDPR_EXPORT_STATUSES = ['requested', 'processing', 'ready'] as const;
export const gdprExportStatus = z.enum(GDPR_EXPORT_STATUSES);
export type GdprExportStatus = z.infer<typeof gdprExportStatus>;

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
