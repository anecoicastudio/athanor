import { z } from 'zod';

// Mirrors the `reports_target_type_check` CHECK — declared inline by
// supabase/migrations/20260620011307_m9_reports.sql (06 §2.9), widened with 'message' by
// 20260831153523 (#574). `packages/schemas/src/admin.ts` DERIVES the admin queue's enum from
// `reportTargetType` below rather than re-declaring it, so this array is the single spelling
// on the TypeScript side and the CHECK is the single spelling in the database.
export const REPORT_TARGET_TYPES = ['person', 'post', 'behavior', 'message'] as const;
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
// RLS WITH CHECK pins reporter_id=auth.uid() and status='open'.
//
// targetId (#611): required for 'person' | 'post' | 'message', optional for 'behavior' — the
// column was declared nullable "for 'behavior' (no specific subject)" (20260620011307:11) and
// for no other reason, and reports_target_required_unless_behavior (20260904152300) now holds
// that line in the database. The rule is one-directional: a 'behavior' report MAY still carry a
// target (the staging seed files one), the other three MUST. For 'message' it is a
// `public.messages` id with no FK, so an erased message leaves the report pointing at nothing
// and the admin read path resolves that to "no longer available" — a target that is later
// erased, not a report filed without one. The refine keeps the column's `.nullish()` shape so
// the inferred type is unchanged for every caller; `submitReport` (packages/api) parses through
// this before the insert, so a targetless 'person' report is a Zod issue and never a 23514.
export const reportInput = z
  .object({
    targetType: reportTargetType,
    targetId: z.string().uuid().nullish(),
    category: reportCategory,
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.targetType !== 'behavior' && v.targetId == null)
      ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'target_required' });
  });
export type ReportInput = z.infer<typeof reportInput>;
