import { z } from 'zod';
import { trimmedNonBlank } from './primitives.ts';
import { fundEditionSchema } from './fund.ts';
import { messageSchema } from './message.ts';
import { reportTargetType } from './report.ts';

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

/**
 * The audit_log vocabulary, split the way the database splits it. Two CHECK constraints
 * govern it and both are re-declared whole by whichever migration last widened them —
 * currently `20260816110227_fund_tranche_gate.sql:43-54`:
 *
 * - `audit_log_action_check` admits MODERATION ∪ FUND, in this order;
 * - `audit_log_fund_shape` names exactly FUND, and demands those rows carry an edition
 *   and neither a report nor penalty points.
 *
 * Two lists rather than one because that second constraint needs the halves apart. The
 * previous single inline `z.enum` fell twelve actions behind across five migrations before
 * anything noticed (#392) — so widening the CHECK now means adding the action to the
 * matching list below, and `audit-log-actions.mirror.test.ts` fails when one side moves alone.
 */
/**
 * `resolve_report` journals its `p_action` verbatim, and `@athanor/api`'s `resolveReport`
 * derives that from the verdict as `uphold ? (action ?? 'penalty') : 'dismiss'` — so the
 * moderation half is the four enforcement actions plus the dismissal, and it is DERIVED
 * rather than re-declared. A fifth enforcement action would then need the CHECK widened too,
 * which is exactly what the mirror test would say.
 */
export const AUDIT_LOG_MODERATION_ACTIONS = ['dismiss', ...MODERATION_ACTIONS] as const;

export const AUDIT_LOG_FUND_ACTIONS = [
  'declare_winner',
  'screen_start',
  'screen_pass',
  'screen_reject',
  'screen_reopen',
  'announce',
  'void_cycle',
  'winner_confirm',
  'winner_decline',
  'close_cycle',
  'rollover_cycle',
  'publish_plan',
  'verify_phase',
] as const;

export const AUDIT_LOG_ACTIONS = [
  ...AUDIT_LOG_MODERATION_ACTIONS,
  ...AUDIT_LOG_FUND_ACTIONS,
] as const;

export const auditLogAction = z.enum(AUDIT_LOG_ACTIONS);
export type AuditLogAction = z.infer<typeof auditLogAction>;

/** Set lookup so the shape refinement below stays O(1) as the fund vocabulary grows. */
const FUND_ACTIONS: ReadonlySet<string> = new Set(AUDIT_LOG_FUND_ACTIONS);

/**
 * Append-only audit row (admin-read). Mirrors supabase audit_log, which since #219 holds
 * two shapes: moderation rows (report_id + actor_id set) and fund rows (edition_id set,
 * no report, no user actor — the writer is the service-role edge function; 'publish_plan'
 * alone carries a real actor, being the only fund action a member takes themselves).
 *
 * The refinement is `audit_log_fund_shape` in TypeScript. Without it this schema accepted
 * `{ action: 'declare_winner', report_id: <uuid> }` — a row the database has never been
 * able to hold.
 */
export const auditLogRow = z
  .object({
    id: z.string().uuid(),
    report_id: z.string().uuid().nullable(),
    actor_id: z.string().uuid().nullable(),
    action: auditLogAction,
    penalty_points: z.number().int().nullable(),
    reason: z.string().nullable(),
    created_at: z.string(),
    edition_id: z.string().uuid().nullable(),
    candidacy_id: z.string().uuid().nullable(),
  })
  .refine(
    (r) =>
      !FUND_ACTIONS.has(r.action) ||
      (r.edition_id !== null && r.report_id === null && r.penalty_points === null),
    {
      message: 'a fund action carries an edition and neither a report nor penalty points',
      path: ['edition_id'],
    },
  );
export type AuditLogRow = z.infer<typeof auditLogRow>;

/** Admin queue row shape (read from reports table + reporter join). */
export const adminReportRow = z.object({
  id: z.string().uuid(),
  // DERIVED from `reportTargetType`, not re-declared (rules/schemas.md). It was a second copy
  // until #574, and the copy is exactly what went stale: widening the CHECK with 'message'
  // moved the reporter-side vocabulary and left the admin queue refusing the rows it now had
  // to render. One entity, one spelling — a third target type only has to be added in
  // `report.ts` and in the migration that widens the CHECK.
  target_type: reportTargetType,
  target_id: z.string().uuid().nullable(),
  category: z.string(),
  status: z.string(),
  created_at: z.string(),
  reporter_handle: z.string().nullable(),
});
export type AdminReportRow = z.infer<typeof adminReportRow>;

/**
 * The reported message itself — the evidence a `target_type = 'message'` report points at (#574).
 *
 * Derived from `messageSchema` rather than re-declared (rules/schemas.md), then narrowed to the
 * four columns the panel renders. The narrowing is the point: `conversation_id` is deliberately
 * NOT here. #97's ruling (2026-08-30) scopes the admin read to reported content only, and a
 * conversation id on an admin surface is an invitation to widen the query to the thread — the
 * one thing the ruling forbids. `sender_handle` rides along because the verdict lands on the
 * sender (`resolve_report` v5 resolves the subject the same way), and a moderator who cannot
 * see whose message it is cannot judge it.
 *
 * `media_url` is a `chat-media` storage KEY, never a URL (20260827054252). The panel signs it
 * per render; nothing persists a signed URL.
 */
export const adminReportedMessage = messageSchema
  .pick({ id: true, body: true, media_url: true, created_at: true })
  .extend({ sender_handle: z.string().nullable() });
export type AdminReportedMessage = z.infer<typeof adminReportedMessage>;

/**
 * Admin detail shape (report + audit trail + target handle).
 *
 * `auditExcluded` counts the audit rows the reader could not validate and therefore
 * withheld from `audit`. It exists because an audit trail that silently renders short is
 * indistinguishable from an audit trail that is short: the panel needs to be able to say
 * "n entries could not be displayed" rather than quietly show fewer. Zero on every healthy
 * read; non-zero means the schema and the database disagree about a row (#392's failure
 * mode) and the trail on screen is incomplete.
 */
export const adminReportDetail = adminReportRow.extend({
  note: z.string().nullable(),
  resolution: z.string().nullable(),
  target_handle: z.string().nullable(),
  audit: z.array(auditLogRow),
  auditExcluded: z.number().int().nonnegative(),
  /**
   * The reported message, on a `'message'` report only (#574) — null everywhere else, and null
   * on a message report whose target no longer resolves: `reports.target_id` has no FK, so an
   * erased or soft-deleted message leaves the report pointing at nothing. Null therefore means
   * "not applicable OR no longer available", and the panel says the second out loud rather than
   * rendering an empty evidence box.
   */
  reportedMessage: adminReportedMessage.nullable(),
});
export type AdminReportDetail = z.infer<typeof adminReportDetail>;

/**
 * Admin fund-audit index row — the subset of a cycle the operator index needs to name one,
 * order them, and link to its trail (#432).
 *
 * Picked from `fundEditionSchema` rather than re-declared (rules/schemas.md): a cycle is one
 * entity, and the index is a projection of it. Declaring these six fields again would be the
 * second copy that stops getting the next column's type change.
 */
export const adminFundEditionRow = fundEditionSchema.pick({
  id: true,
  phase: true,
  target_at: true,
  created_at: true,
  closure_reason: true,
  winner_candidacy_id: true,
});
export type AdminFundEditionRow = z.infer<typeof adminFundEditionRow>;
