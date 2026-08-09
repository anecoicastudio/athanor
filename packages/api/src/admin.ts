// Moderation API — consumed by the web admin panel (apps/web/app/admin) since the
// web app returned in merge 34ff635.
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

export const adminReportKeys = {
  all: ['admin', 'reports'] as const,
  queue: (status: string) => [...adminReportKeys.all, 'queue', status] as const,
  detail: (id: string) => [...adminReportKeys.all, 'detail', id] as const,
};

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
    // keyset: rows strictly "after" the cursor in (created_at desc, id desc). A cursor missing
    // either half is ignored rather than interpolated — `id.lt.undefined` is not a filter.
    const [ts, id] = opts.cursor.split('|');
    if (ts && id) q = q.or(keysetFilter('created_at', 'id', ts, id, 'lt'));
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

/** Submit a verdict. Maps the camelCase input to the resolve_report RPC params. */
export async function resolveReport(
  client: AthanorClient,
  input: ResolveReportInput,
): Promise<void> {
  const uphold = input.verdict === 'uphold';
  // `resolveReportInput` refines severity to be mandatory on an uphold, but the inferred type
  // leaves it optional, so this function is callable without one. Fail loudly rather than send
  // `p_action: 'penalty'` with no points — that would write an audit_log row and enqueue a
  // score award worth nothing, i.e. a penalty the moderator believes they applied.
  if (uphold && !input.severity) {
    throw new Error('resolveReport: an uphold verdict requires a severity');
  }
  // `p_severity`/`p_penalty_points` are `default null` in the SQL (m9_resolve_report_person_penalty),
  // so omitting them on a dismissal is identical to passing null — and it types, which the
  // previous `as any` casts existed to avoid. Same conditional-args shape as `createEvent`.
  // NOTE: only one `resolve_report` signature exists (the m9 migration `create or replace`d it
  // rather than overloading). If a second is ever added, omitted args become ambiguous to
  // PostgREST (PGRST203) where explicit nulls would not.
  const rpcArgs: {
    p_report_id: string;
    p_status: string;
    p_resolution: string;
    p_action: string;
    p_severity?: string;
    p_penalty_points?: number;
  } = {
    p_report_id: input.reportId,
    p_status: uphold ? 'upheld' : 'dismissed',
    p_resolution: input.resolution,
    p_action: uphold ? 'penalty' : 'dismiss',
  };
  if (input.severity && uphold) {
    rpcArgs.p_severity = input.severity;
    rpcArgs.p_penalty_points = reportPenaltyPoints(input.severity);
  }

  const { error } = await client.rpc('resolve_report', rpcArgs);
  if (error) throw error;
}
