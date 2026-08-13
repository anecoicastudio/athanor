// Moderation API — consumed by the web admin panel (apps/web/app/admin), which reads it
// from Server Components and Server Actions (no TanStack Query on that surface).
import { reportPenaltyPoints } from '@athanor/core';
import {
  type ResolveReportInput,
  type AuditLogRow,
  type AdminReportRow,
  type AdminReportDetail,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter } from './pagination';

export type { AdminReportRow, AdminReportDetail } from '@athanor/schemas';

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
    .select('id, report_id, actor_id, action, penalty_points, reason, created_at')
    .eq('report_id', id)
    .order('created_at', { ascending: false });
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
    audit: (audit ?? []) as AuditLogRow[],
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
