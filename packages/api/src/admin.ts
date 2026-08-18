// Admin API — consumed by the web admin panel (apps/web/app/admin), which reads it
// from Server Components and Server Actions (no TanStack Query on that surface).
// Two surfaces live here: moderation (reports + their verdicts) and the fund audit trail
// (#432), which share `audit_log` and therefore share its parse-at-the-boundary shape.
import { reportPenaltyPoints } from '@athanor/core';
import {
  auditLogRow,
  adminFundEditionRow,
  type ResolveReportInput,
  type AuditLogRow,
  type AdminReportRow,
  type AdminReportDetail,
  type AdminFundEditionRow,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter } from './pagination';

export type { AdminReportRow, AdminReportDetail, AdminFundEditionRow } from '@athanor/schemas';

/** The columns every `audit_log` reader here selects — one list, so two readers cannot drift. */
const AUDIT_COLUMNS =
  'id, report_id, actor_id, action, penalty_points, reason, created_at, edition_id, candidacy_id';

/**
 * Structural stand-in for a Zod schema's `safeParse`. This package does not depend on `zod`
 * — it consumes `@athanor/schemas`' already-built schemas — so the helper below is typed by
 * shape rather than by importing `ZodTypeAny`, which would mean adding the dependency to get
 * one generic parameter.
 */
type BoundaryParser<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: (string | number)[]; message: string }[] };
      };
};

/**
 * Parse a result set row by row: valid rows through, invalid rows withheld and counted.
 *
 * #421's shape, extracted once three readers needed it. Per-row `safeParse` rather than this
 * package's usual `.parse()`-and-throw, because the consequence differs: every other query
 * boundary feeds a content screen, while these feed operator surfaces. The realistic failure
 * is the schema lagging the database — #392, which went five actions and five migrations
 * unnoticed — and on that failure a throw takes the whole view down over one unrecognised
 * row. Withholding keeps the surface up; returning `excluded` keeps the omission honest,
 * because silently dropping evidence is the other way to be wrong.
 *
 * `table` and `surface` only shape the warning; the caller says which reader spoke.
 */
function parseOrWithhold<T>(
  rows: readonly unknown[] | null | undefined,
  parser: BoundaryParser<T>,
  table: string,
  surface: string,
): { parsed: T[]; excluded: number } {
  const parsed: T[] = [];
  let excluded = 0;
  for (const row of rows ?? []) {
    const result = parser.safeParse(row);
    if (result.success) {
      parsed.push(result.data);
      continue;
    }
    excluded += 1;
    // No logger exists in this package; a warning is the only channel that reaches
    // `wrangler tail`, and the row id plus the failing path is what makes the row findable.
    console.warn(
      `[admin] ${table} row ${String((row as { id?: unknown }).id)} withheld from ${surface}: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return { parsed, excluded };
}

const PAGE = 25;

/** Cursor = `${created_at}|${id}`. Keyset, never offset (rule #9). */
export async function getReportQueue(
  client: AthanorClient,
  opts: { status: 'open' | 'reviewing' | 'resolved'; cursor?: string | null; limit?: number },
): Promise<{ rows: AdminReportRow[]; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE;
  let q = client
    .from('reports')
    .select(
      'id, target_type, target_id, category, status, created_at, reporter:profiles!reports_reporter_id_fkey(handle)',
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.status === 'resolved') q = q.in('status', ['upheld', 'dismissed']);
  else q = q.eq('status', opts.status);
  if (opts.cursor) {
    // keyset: rows strictly "after" the cursor in (created_at desc, id desc).
    const [ts, id] = opts.cursor.split('|');
    // The cursor is opaque and server-issued, so a half of it missing is a caller bug. Rejecting
    // says so; interpolating it built the literal filter `id.lt.undefined` (PostgREST then failed
    // on the uuid), and silently dropping the predicate would restart a moderator's queue at
    // page 1 without a word — the failure mode that looks like it worked.
    if (!ts || !id) throw new Error(`malformed report cursor: ${opts.cursor}`);
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;
  const rows: AdminReportRow[] = page.map((r) => ({
    id: r.id,
    // `reports.target_type` is a text column; the union lives in the schema. Same narrowing
    // `getReportDetail` below already applies — kept identical rather than diverging.
    target_type: r.target_type as AdminReportRow['target_type'],
    target_id: r.target_id,
    category: r.category,
    status: r.status,
    created_at: r.created_at,
    reporter_handle: r.reporter?.handle ?? null,
  }));
  const last = rows[rows.length - 1];
  return { rows, nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null };
}

/**
 * Read one report with its append-only audit trail.
 *
 * The audit rows go through `parseOrWithhold` rather than a cast, so `auditLogRow`'s
 * guarantees — the 18-action vocabulary and the `audit_log_fund_shape` refinement (#419) —
 * actually execute at the boundary instead of being a compile-time claim. Why withhold
 * rather than throw is argued at the helper.
 *
 * Which half of the vocabulary can actually trip it is worth being exact about: this query
 * filters on `report_id`, and `audit_log_fund_shape` forbids a fund row from carrying one,
 * so no fund action ever reaches this loop. A widening of the MODERATION half is what would
 * — a fifth enforcement action beside warn/penalty/suspend/ban. The fund half is read by
 * `getEditionAuditTrail` below, which keys on the edition instead.
 */
export async function getReportDetail(
  client: AthanorClient,
  id: string,
): Promise<AdminReportDetail> {
  const { data, error } = await client
    .from('reports')
    .select(
      'id, target_type, target_id, category, status, created_at, note, resolution, reporter:profiles!reports_reporter_id_fkey(handle)',
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  let target_handle: string | null = null;
  if (data.target_type === 'person' && data.target_id) {
    const { data: t } = await client
      .from('profiles')
      .select('handle')
      .eq('id', data.target_id)
      .maybeSingle();
    target_handle = t?.handle ?? null;
  }
  const { data: audit } = await client
    .from('audit_log')
    .select(AUDIT_COLUMNS)
    .eq('report_id', id)
    .order('created_at', { ascending: false });
  const { parsed: parsedAudit, excluded: auditExcluded } = parseOrWithhold<AuditLogRow>(
    audit,
    auditLogRow,
    'audit_log',
    'the trail',
  );
  return {
    id: data.id,
    target_type: data.target_type as AdminReportRow['target_type'],
    target_id: data.target_id,
    category: data.category,
    status: data.status,
    created_at: data.created_at,
    note: data.note,
    resolution: data.resolution,
    reporter_handle: data.reporter?.handle ?? null,
    target_handle,
    audit: parsedAudit,
    auditExcluded,
  };
}

/**
 * Submit a verdict. Maps the camelCase input to the resolve_report RPC params.
 *
 * An uphold carries one of the four PRD §4.13 actions (#106); an omitted `action` is a
 * penalty, which keeps every pre-#106 caller working unchanged. `now` is injectable so the
 * suspend-until arithmetic is testable at a boundary.
 */
export async function resolveReport(
  client: AthanorClient,
  input: ResolveReportInput,
  now: () => Date = () => new Date(),
): Promise<void> {
  const uphold = input.verdict === 'uphold';
  const action = uphold ? (input.action ?? 'penalty') : 'dismiss';
  // `resolveReportInput` refines these to be mandatory, but the inferred type leaves them
  // optional, so this function is callable without them. Fail loudly rather than send a
  // penalty worth nothing or a suspension with no end date — the SQL would 22023 the latter,
  // but the former would write an audit_log row for a deduction that never happens.
  if (action === 'penalty' && !input.severity) {
    throw new Error('resolveReport: a penalty verdict requires a severity');
  }
  if (action === 'suspend' && !input.suspendDays) {
    throw new Error('resolveReport: a suspend verdict requires suspendDays');
  }
  // `p_severity`/`p_penalty_points`/`p_suspend_until` are `default null` in the SQL
  // (moderation_suspend_ban), so omitting them is identical to passing null — and it types,
  // which the previous `as any` casts existed to avoid. Same conditional-args shape as
  // `createEvent`.
  // NOTE: only one `resolve_report` signature exists (the #106 migration DROPs before it
  // CREATEs, and pgTAP 0091 asserts the count stays 1). If a second is ever added, omitted
  // args become ambiguous to PostgREST (PGRST203) where explicit nulls would not.
  const rpcArgs: {
    p_report_id: string;
    p_status: string;
    p_resolution: string;
    p_action: string;
    p_severity?: string;
    p_penalty_points?: number;
    p_suspend_until?: string;
  } = {
    p_report_id: input.reportId,
    p_status: uphold ? 'upheld' : 'dismissed',
    p_resolution: input.resolution,
    p_action: action,
  };
  if (action === 'penalty' && input.severity) {
    rpcArgs.p_severity = input.severity;
    rpcArgs.p_penalty_points = reportPenaltyPoints(input.severity);
  }
  if (action === 'suspend' && input.suspendDays) {
    rpcArgs.p_suspend_until = new Date(
      now().getTime() + input.suspendDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  const { error } = await client.rpc('resolve_report', rpcArgs);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Fund audit trail (#432). Every fund transition journals an `audit_log` row keyed on
// `edition_id`; `audit_log_fund_shape` forbids those rows a `report_id`, so the moderation
// reader above can never return one. These two are the readers that can.
//
// Privilege is the same route as the moderation reader — no second one. `audit_log` carries
// exactly one policy, `audit_log_select_admin` (`20260622142310_m9_admin_moderation.sql`),
// `for select to authenticated using (athanor.is_admin())`, with no report/edition predicate;
// the panel reaches it with the caller's own session through `createAuthedClient()`, never a
// service-role client. A non-admin session reads zero rows rather than being refused, which
// is RLS working. `fund_editions` is public-readable (`fund_editions_select_public`), so the
// index below needs no privilege at all — it is here because the audit surface is its only
// consumer, not because it is admin-gated.
// ---------------------------------------------------------------------------

/**
 * The cycles the fund-audit index lists, newest first.
 *
 * Cursor-paginated (rule #9) even though a cycle is a months-long object and there will only
 * ever be a handful: a page size is the only honest way to bound a list that grows forever,
 * and a `limit` with no cursor would silently truncate the oldest cycles the day there are
 * more than one page — the same defect this issue exists to fix, one level up.
 *
 * Cursor = `${created_at}|${id}`.
 */
export async function getFundEditionIndex(
  client: AthanorClient,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ rows: AdminFundEditionRow[]; excluded: number; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE;
  let q = client
    .from('fund_editions')
    .select('id, phase, target_at, created_at, closure_reason, winner_candidacy_id')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) {
    const [ts, id] = opts.cursor.split('|');
    // Same stance as `getReportQueue`: the cursor is opaque and server-issued, so a half of
    // it missing is a caller bug. Refusing says so; dropping the predicate would restart the
    // list at page 1 without a word.
    if (!ts || !id) throw new Error(`malformed fund edition cursor: ${opts.cursor}`);
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;
  const { parsed, excluded } = parseOrWithhold<AdminFundEditionRow>(
    page,
    adminFundEditionRow,
    'fund_editions',
    'the cycle index',
  );
  // The cursor comes from the last RAW row of the page, not the last parsed one. A withheld
  // tail row would otherwise move the cursor backwards and serve the next page overlapping
  // this one — showing an operator the same cycle twice while still hiding the bad row.
  const last = page[page.length - 1];
  return {
    rows: parsed,
    excluded,
    nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}

/**
 * One cycle's append-only audit trail, newest first — the thirteen fund transitions
 * (`declare_winner`, the four `screen_*`, `announce`, `void_cycle`, `winner_confirm`,
 * `winner_decline`, `close_cycle`, `rollover_cycle`, `publish_plan`, `verify_phase`) that
 * were being written faithfully and read by nothing.
 *
 * Keyed on `edition_id`, which is what makes it the complement of `getReportDetail`'s trail
 * rather than a widening of it: the two filters are mutually exclusive by CHECK constraint.
 * `audit_log_edition` on `(edition_id, created_at desc)` already indexes exactly this order.
 *
 * Cursor = `${created_at}|${id}`. Rows the schema rejects are withheld and counted, never
 * dropped in silence — see `parseOrWithhold`.
 */
export async function getEditionAuditTrail(
  client: AthanorClient,
  editionId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ rows: AuditLogRow[]; excluded: number; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE;
  let q = client
    .from('audit_log')
    .select(AUDIT_COLUMNS)
    .eq('edition_id', editionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) {
    const [ts, id] = opts.cursor.split('|');
    if (!ts || !id) throw new Error(`malformed edition audit cursor: ${opts.cursor}`);
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;
  const { parsed, excluded } = parseOrWithhold<AuditLogRow>(
    page,
    auditLogRow,
    'audit_log',
    'the cycle trail',
  );
  // Raw tail, not parsed tail — see `getFundEditionIndex`. It matters more here: the rows a
  // trail withholds are precisely the ones an operator is looking for.
  const last = page[page.length - 1];
  return {
    rows: parsed,
    excluded,
    nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}
