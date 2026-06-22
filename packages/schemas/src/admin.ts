import { z } from 'zod';

/** Moderation severity → maps to REPORT_PENALTY in @athanor/core (rule #10). */
export const REPORT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const reportSeverity = z.enum(REPORT_SEVERITIES);
export type ReportSeverity = z.infer<typeof reportSeverity>;

/** Verdict the admin submits from /admin/reports/[id]. MVP: dismiss | uphold. */
export const resolveReportInput = z
  .object({
    reportId: z.string().uuid(),
    verdict: z.enum(['dismiss', 'uphold']),
    resolution: z.string().trim().min(1).max(2000),
    severity: reportSeverity.optional(),
  })
  .refine((v) => v.verdict !== 'uphold' || v.severity != null, {
    message: 'severity required when upholding',
    path: ['severity'],
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
