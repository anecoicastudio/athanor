import { z } from 'zod';

// Mirrors supabase/migrations/20260620011307_m9_reports.sql (06 §2.9).
export const REPORT_TARGET_TYPES = ['person', 'post', 'behavior'] as const;
export const reportTargetType = z.enum(REPORT_TARGET_TYPES);
export type ReportTargetType = z.infer<typeof reportTargetType>;

// Reason categories — aligned to PRD §4.13 ethical guidelines (frontend 09 §3.3).
export const REPORT_CATEGORIES = [
  'selling',
  'income',
  'mlm',
  'harassment',
  'spam',
  'impersonation',
  'other',
] as const;
export const reportCategory = z.enum(REPORT_CATEGORIES);
export type ReportCategory = z.infer<typeof reportCategory>;

export const REPORT_STATUSES = ['open', 'reviewing', 'upheld', 'dismissed'] as const;
export const reportStatus = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatus>;

// Reporter reads OWN row only (never another's, never a verdict beyond own status).
export const reportSchema = z.object({
  id: z.string().uuid(),
  reporter_id: z.string().uuid(),
  target_type: reportTargetType,
  target_id: z.string().uuid().nullable(),
  category: reportCategory,
  note: z.string().nullable(),
  status: reportStatus,
  created_at: z.string(),
});
export type Report = z.infer<typeof reportSchema>;

// Insert input (camelCase from the report sheet). reporter_id + status default server-side;
// RLS WITH CHECK pins reporter_id=auth.uid() and status='open'. targetId is null for 'behavior'.
export const reportInput = z.object({
  targetType: reportTargetType,
  targetId: z.string().uuid().nullish(),
  category: reportCategory,
  note: z.string().trim().max(2000).optional(),
});
export type ReportInput = z.infer<typeof reportInput>;
