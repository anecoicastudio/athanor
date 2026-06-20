import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_m9_gdpr_export_erasure.sql · gdpr_erasure_requests (10 §5.4).
// GATED: owner inserts a request; the service-role erasure-job processes the cascade.
export const GDPR_ERASURE_STATUSES = ['requested', 'processing', 'done', 'failed'] as const;
export const gdprErasureStatus = z.enum(GDPR_ERASURE_STATUSES);
export type GdprErasureStatus = z.infer<typeof gdprErasureStatus>;

export const gdprErasureRequestSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  status: gdprErasureStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type GdprErasureRequest = z.infer<typeof gdprErasureRequestSchema>;
