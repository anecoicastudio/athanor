// Admin API — consumed by the web admin panel (apps/web/app/admin), which reads it
// from Server Components and Server Actions (no TanStack Query on that surface).
// Three surfaces live here: moderation (reports + their verdicts), the fund audit trail
// (#432) — those two share `audit_log` and its parse-at-the-boundary shape — and the
// pre-launch waitlist (#335), read through its admin RPCs.
import { reportPenaltyPoints } from '@athanor/core';
import {
  auditLogRow,
  adminFundEditionRow,
  waitlistAdminRowSchema,
  type ResolveReportInput,
  type AuditLogRow,
  type AdminReportRow,
  type AdminReportDetail,
  type AdminFundEditionRow,
  type WaitlistAdminRow,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { decodeCursor, keysetFilter, probePage, tailCursor } from './pagination';
import { parseOrWithhold } from './parse-or-withhold';

export type {
  AdminReportRow,
  AdminReportDetail,
  AdminFundEditionRow,
  WaitlistAdminRow,
} from '@athanor/schemas';

/** The columns every `audit_log` reader here selects — one list, so two readers cannot drift. */
const AUDIT_COLUMNS =
  'id, report_id, actor_id, action, penalty_points, reason, created_at, edition_id, candidacy_id';

/** The columns every `fund_editions` reader here selects — `adminFundEditionRow`'s exact shape. */
const EDITION_COLUMNS = 'id, phase, target_at, created_at, closure_reason, winner_candidacy_id';

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
    // keyset: rows strictly "after" the cursor in (created_at desc, id desc). A half cursor is
    // refused, never dropped — decodeCursor carries the queue-restarting failure that taught us.
    const { ts, id } = decodeCursor(opts.cursor, 'report');
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const { page, hasMore } = probePage(data ?? [], limit);
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
  return { rows, nextCursor: tailCursor(page, hasMore) };
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
    .select(EDITION_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) {
    const { ts, id } = decodeCursor(opts.cursor, 'fund edition');
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const { page, hasMore } = probePage(data ?? [], limit);
  const { parsed, excluded } = parseOrWithhold<AdminFundEditionRow>(
    page,
    adminFundEditionRow,
    'fund_editions',
    'the cycle index',
  );
  // The cursor comes from the last RAW row of the page, not the last parsed one (tailCursor):
  // a withheld tail row would otherwise serve the next page overlapping this one — showing an
  // operator the same cycle twice while still hiding the bad row.
  return { rows: parsed, excluded, nextCursor: tailCursor(page, hasMore) };
}

/**
 * One cycle, by id — what the audit view names its trail with.
 *
 * Three-state on purpose, because "no such cycle" and "a cycle whose row I could not read"
 * are different facts and only one of them is a 404. A bare `null` would collapse them, and
 * the collapse is this issue's own defect one level down: an empty trail rendered for a
 * mistyped id reads exactly like a real cycle that has not transitioned yet.
 *
 * `row === null && excluded === 0` — the cycle does not exist.
 * `row === null && excluded === 1` — it exists and the schema rejected it; the caller should
 * still show the trail, which is the part that matters, and say the header is degraded.
 */
export async function getFundEdition(
  client: AthanorClient,
  id: string,
): Promise<{ row: AdminFundEditionRow | null; excluded: number }> {
  const { data, error } = await client
    .from('fund_editions')
    .select(EDITION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { row: null, excluded: 0 };
  const { parsed, excluded } = parseOrWithhold<AdminFundEditionRow>(
    [data],
    adminFundEditionRow,
    'fund_editions',
    'the cycle header',
  );
  return { row: parsed[0] ?? null, excluded };
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
    const { ts, id } = decodeCursor(opts.cursor, 'edition audit');
    q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const { page, hasMore } = probePage(data ?? [], limit);
  const { parsed, excluded } = parseOrWithhold<AuditLogRow>(
    page,
    auditLogRow,
    'audit_log',
    'the cycle trail',
  );
  // Raw tail, not parsed tail (tailCursor). It matters more here: the rows a trail withholds
  // are precisely the ones an operator is looking for.
  return { rows: parsed, excluded, nextCursor: tailCursor(page, hasMore) };
}

// ── Pre-launch waitlist ──────────────────────────────────────────────────────────────────
// Read through SECURITY DEFINER RPCs that re-check `is_admin()` server-side: `email_waitlist`
// has no SELECT policy at all, so the function is the only read path and this package never
// gates on a client-side role (it is plumbing). Both moved here from waitlist.ts with #335 —
// that module keeps the public write boundary the landing uses; the panel's reads belong
// with the panel's other reads.

/**
 * Admin-only count of waitlist signups (the "how many are interested" number). Raises 42501
 * for non-admins; surfaced, never turned into a zero.
 */
export async function getWaitlistCount(client: AthanorClient): Promise<number> {
  const { data, error } = await client.rpc('admin_waitlist_count');
  if (error) throw error;
  return data ?? 0;
}

/**
 * The RPC clamps `p_limit` to 1000 and this reader asks for `limit + 1` to learn whether a
 * next page exists, so a page of 1000 could never see its probe row and a cursor walk would
 * end a page early with no error. Refused up front instead. The two numbers are pinned
 * separately — pgTAP 0127 asserts the clamp is exactly 1000, admin.test.ts asserts this is
 * 999 — so moving either alone goes red.
 */
export const WAITLIST_PAGE_CEILING = 999;

/**
 * One page of the waitlist, newest first. Cursor = `${created_at}|${id}`, the same opaque
 * shape as every reader here, but the keyset predicate lives INSIDE `admin_list_waitlist`
 * (migration 20260821085655) rather than in a PostgREST filter — the table is unreadable by
 * clients, so the DEFINER function is where the `(created_at, id) <` comparison has to run.
 * Same probe-row contract as `getReportQueue`, same raw-tail cursor as `getFundEditionIndex`,
 * rows parsed and withheld rather than cast (api.md).
 */
export async function getWaitlistPage(
  client: AthanorClient,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ rows: WaitlistAdminRow[]; excluded: number; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE;
  if (limit < 1 || limit > WAITLIST_PAGE_CEILING) {
    throw new Error(`waitlist page size out of range (1..${WAITLIST_PAGE_CEILING}): ${limit}`);
  }
  const args: { p_limit: number; p_before_created_at?: string; p_before_id?: string } = {
    p_limit: limit + 1,
  };
  if (opts.cursor) {
    const { ts, id } = decodeCursor(opts.cursor, 'waitlist');
    args.p_before_created_at = ts;
    args.p_before_id = id;
  }
  const { data, error } = await client.rpc('admin_list_waitlist', args);
  if (error) throw error;
  const { page, hasMore } = probePage(data ?? [], limit);
  const { parsed, excluded } = parseOrWithhold(
    page,
    waitlistAdminRowSchema,
    'email_waitlist',
    'the waitlist page',
  );
  // Raw tail, not parsed tail (tailCursor) — and no cursor at all when the tail row carries
  // no `id`, which is what the OLD RPC answers while production still lags this migration:
  // every row withheld, and no "load more" into a page that cannot exist.
  return { rows: parsed, excluded, nextCursor: tailCursor(page, hasMore) };
}
