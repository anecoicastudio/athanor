import { z } from 'zod';
import { trimmedNonBlank } from './primitives';

/** Moderation severity → maps to REPORT_PENALTY in @athanor/core (rule #10). */
export const REPORT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const reportSeverity = z.enum(REPORT_SEVERITIES);
export type ReportSeverity = z.infer<typeof reportSeverity>;

/** Enforcement chosen on an uphold (#106, PRD §4.13). Absent = penalty, the pre-#106 contract. */
export const MODERATION_ACTIONS = ['warn', 'penalty', 'suspend', 'ban'] as const;
export const moderationAction = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof moderationAction>;

/** Longest suspension the form can hand over — beyond this the honest action is a ban. */
export const SUSPEND_DAYS_MAX = 365;

/**
 * Verdict the admin submits when resolving a report. dismiss | uphold, and an uphold carries
 * one of the four PRD §4.13 actions (omitted = penalty, so pre-#106 callers keep working).
 * severity travels only with a penalty (it prices the Aura deduction — core maps it, rule #10);
 * suspendDays only with a suspend.
 */
export const resolveReportInput = z
  .object({
    reportId: z.string().uuid(),
    verdict: z.enum(['dismiss', 'uphold']),
    action: moderationAction.optional(),
    resolution: trimmedNonBlank(2000),
    severity: reportSeverity.optional(),
    suspendDays: z.number().int().min(1).max(SUSPEND_DAYS_MAX).optional(),
  })
  .refine((v) => v.verdict === 'uphold' || v.action == null, {
    message: 'action travels only with an uphold',
    path: ['action'],
  })
  .refine(
    (v) => !(v.verdict === 'uphold' && (v.action ?? 'penalty') === 'penalty') || v.severity != null,
    { message: 'severity required when upholding with a penalty', path: ['severity'] },
  )
  .refine(
    (v) => (v.verdict === 'uphold' && (v.action ?? 'penalty') === 'penalty') || v.severity == null,
    { message: 'severity travels only with a penalty', path: ['severity'] },
  )
  .refine((v) => v.action !== 'suspend' || v.suspendDays != null, {
    message: 'suspendDays required when suspending',
    path: ['suspendDays'],
  })
  .refine((v) => v.action === 'suspend' || v.suspendDays == null, {
    message: 'suspendDays travels only with a suspend',
    path: ['suspendDays'],
  });
export type ResolveReportInput = z.infer<typeof resolveReportInput>;

/** Append-only audit row (admin-read). Mirrors supabase audit_log. */
export const auditLogRow = z.object({
  id: z.string().uuid(),
  report_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  action: z.enum(['dismiss', 'warn', 'penalty', 'suspend', 'ban']),
  penalty_points: z.number().int().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});
export type AuditLogRow = z.infer<typeof auditLogRow>;

/** Admin queue row shape (read from reports table + reporter join). */
export const adminReportRow = z.object({
  id: z.string().uuid(),
  target_type: z.enum(['person', 'post', 'behavior']),
  target_id: z.string().uuid().nullable(),
  category: z.string(),
  status: z.string(),
  created_at: z.string(),
  reporter_handle: z.string().nullable(),
});
export type AdminReportRow = z.infer<typeof adminReportRow>;

/** Admin detail shape (report + audit trail + target handle). */
export const adminReportDetail = adminReportRow.extend({
  note: z.string().nullable(),
  resolution: z.string().nullable(),
  target_handle: z.string().nullable(),
  audit: z.array(auditLogRow),
});
export type AdminReportDetail = z.infer<typeof adminReportDetail>;
