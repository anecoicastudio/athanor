import { describe, it, expect, vi } from 'vitest';
import { REPORT_PENALTY } from '@athanor/core';
import { getReportDetail, getReportQueue, resolveReport } from './admin';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';

describe('resolveReport', () => {
  it('calls resolve_report rpc with mapped points for an uphold', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as unknown as AthanorClient;
    await resolveReport(client, {
      reportId: '00000000-0000-0000-0000-000000000001',
      verdict: 'uphold',
      resolution: 'breaks selling rule',
      severity: 'medium',
    });
    expect(rpc).toHaveBeenCalledWith('resolve_report', {
      p_report_id: '00000000-0000-0000-0000-000000000001',
      p_status: 'upheld',
      p_resolution: 'breaks selling rule',
      p_action: 'penalty',
      p_severity: 'medium',
      p_penalty_points: -100,
    });
  });
  // A dismissal omits p_severity/p_penalty_points rather than sending null: both are
  // `default null` in the SQL, so the audit_log row is identical either way, and omitting
  // is what the generated Args type actually permits.
  it('maps dismiss to dismiss, sending no severity or penalty', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await resolveReport({ rpc } as unknown as AthanorClient, {
      reportId: '00000000-0000-0000-0000-000000000002',
      verdict: 'dismiss',
      resolution: 'not a violation',
    });
    expect(rpc).toHaveBeenCalledWith('resolve_report', {
      p_report_id: '00000000-0000-0000-0000-000000000002',
      p_status: 'dismissed',
      p_resolution: 'not a violation',
      p_action: 'dismiss',
    });
  });
  // The schema's .refine makes severity mandatory on an uphold, but the inferred type marks it
  // optional, so this call compiles. Without the guard it would send p_action:'penalty' with no
  // points — a penalty the moderator thinks they applied that scores nothing.
  it('refuses an uphold with no severity rather than sending a pointless penalty', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await expect(
      resolveReport({ rpc } as unknown as AthanorClient, {
        reportId: '00000000-0000-0000-0000-000000000003',
        verdict: 'uphold',
        resolution: 'upheld but nobody said how badly',
      }),
    ).rejects.toThrow(/requires a severity/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Moderation (PRD §4.13). Authority is the server's to check: every verdict goes
// through the resolve_report DEFINER rpc, which re-asserts athanor.is_admin().
// ---------------------------------------------------------------------------

const R1 = '00000000-0000-0000-0000-0000000000c1';
const R2 = '00000000-0000-0000-0000-0000000000c2';
const T1 = '00000000-0000-0000-0000-0000000000d1';

const reportRow = (over: Record<string, unknown> = {}) => ({
  id: R1,
  target_type: 'post',
  target_id: T1,
  category: 'aggressive_selling',
  status: 'open',
  created_at: '2026-08-01T10:00:00Z',
  reporter: { handle: 'elena' },
  ...over,
});

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

describe('resolveReport penalties', () => {
  it.each(['low', 'medium', 'high'] as const)(
    'takes the %s penalty from the core weights rather than a local number (rule #10)',
    async (severity) => {
      const rpc = vi.fn().mockResolvedValue({ error: null });
      await resolveReport({ rpc } as never, {
        reportId: R1,
        verdict: 'uphold',
        resolution: 'breaks the ethical guidelines',
        severity,
      });
      expect(rpc.mock.calls[0]![1]).toMatchObject({
        p_severity: severity,
        p_penalty_points: REPORT_PENALTY[severity],
      });
    },
  );

  it('keeps every penalty inside the PRD §4.9 band of −50…−200', async () => {
    for (const severity of ['low', 'medium', 'high'] as const) {
      const rpc = vi.fn().mockResolvedValue({ error: null });
      await resolveReport({ rpc } as never, {
        reportId: R1,
        verdict: 'uphold',
        resolution: 'x',
        severity,
      });
      const points = rpc.mock.calls[0]![1].p_penalty_points as number;
      expect(points).toBeLessThanOrEqual(-50);
      expect(points).toBeGreaterThanOrEqual(-200);
    }
  });
});

describe('resolveReport authority', () => {
  it('expresses the verdict only as an rpc — never a direct table write', async () => {
    const fake = makeFakeClient({ 'rpc.resolve_report': [{ error: null }] });
    await resolveReport(asClient(fake), {
      reportId: R1,
      verdict: 'uphold',
      resolution: 'x',
      severity: 'low',
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.op).toBe('rpc');
    expect(fake.calls[0]!.columns).toBe('resolve_report');
    expect(fake.calls.some((c) => ['reports', 'audit_log', 'profiles'].includes(c.table))).toBe(
      false,
    );
  });

  it('writes no Aura — the engine applies the penalty (rule #1)', async () => {
    const fake = makeFakeClient({ 'rpc.resolve_report': [{ error: null }] });
    await resolveReport(asClient(fake), {
      reportId: R1,
      verdict: 'uphold',
      resolution: 'x',
      severity: 'high',
    });
    expect(fake.calls.some((c) => ['aura_events', 'aura_scores'].includes(c.table))).toBe(false);
  });

  it('surfaces the server refusing a non-admin caller', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'not authorized', code: '42501' } });
    await expect(
      resolveReport({ rpc } as never, {
        reportId: R1,
        verdict: 'dismiss',
        resolution: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('getReportQueue', () => {
  it('keyset-paginates the queue and never issues an offset range (rule #9)', async () => {
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow(), reportRow({ id: R2 })] }],
    });
    const page = await getReportQueue(asClient(fake), { status: 'open', limit: 2 });

    expect(page.rows).toHaveLength(2);
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'status', 'open']]));
  });

  it('encodes the cursor as created_at|id and sends it as a keyset predicate', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [] }] });
    await getReportQueue(asClient(fake), {
      status: 'reviewing',
      cursor: `2026-08-01T10:00:00Z|${R1}`,
    });
    const or = fake.calls[0]!.filters.find((f) => f[0] === 'or');
    // Pin the whole disjunction, not just the first half: the tie-break arm is what stops a
    // second report sharing a timestamp from being skipped or served twice.
    expect(String(or?.[1])).toBe(
      `created_at.lt.2026-08-01T10:00:00Z,and(created_at.eq.2026-08-01T10:00:00Z,id.lt.${R1})`,
    );
  });

  it('rejects a half-parsed cursor instead of quietly restarting at page 1', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [] }] });
    await expect(
      getReportQueue(asClient(fake), { status: 'open', cursor: 'garbage' }),
    ).rejects.toThrow(/malformed report cursor/);
    await expect(
      getReportQueue(asClient(fake), { status: 'open', cursor: '2026-08-01T10:00:00Z|' }),
    ).rejects.toThrow(/malformed report cursor/);
    expect(fake.calls).toEqual([]);
  });

  it('returns a null cursor on a short page', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [reportRow()] }] });
    const page = await getReportQueue(asClient(fake), { status: 'open', limit: 25 });
    expect(page.nextCursor).toBeNull();
  });

  it('flattens the reporter handle for the queue row', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [reportRow()] }] });
    const page = await getReportQueue(asClient(fake), { status: 'open' });
    expect(page.rows[0]!).toMatchObject({ id: R1, reporter_handle: 'elena' });
  });

  it('reads the queue without writing anything', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [reportRow()] }] });
    await getReportQueue(asClient(fake), { status: 'resolved' });
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ error: { message: 'boom' } }] });
    await expect(getReportQueue(asClient(fake), { status: 'open' })).rejects.toThrow();
  });
});

describe('getReportDetail', () => {
  it('throws rather than returning a partial detail when the report is gone', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: [] }] });
    await expect(getReportDetail(asClient(fake), R1)).rejects.toThrow();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ error: { message: 'boom' } }] });
    await expect(getReportDetail(asClient(fake), R1)).rejects.toThrow();
  });
});

describe('getReportDetail success path', () => {
  const auditRow = {
    id: '00000000-0000-0000-0000-0000000000e1',
    report_id: R1,
    actor_id: '00000000-0000-0000-0000-0000000000f1',
    action: 'penalty',
    penalty_points: -100,
    reason: 'breaks the ethical guidelines',
    created_at: '2026-08-02T09:00:00Z',
  };

  it('assembles the report with its append-only audit trail', async () => {
    const fake = makeFakeClient({
      'reports.select': [
        { data: [reportRow({ note: 'vende corsi in DM', resolution: null, status: 'reviewing' })] },
      ],
      'audit_log.select': [{ data: [auditRow] }],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
      'posts.select': [{ data: [{ id: T1 }] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);

    expect(detail).toMatchObject({
      id: R1,
      status: 'reviewing',
      note: 'vende corsi in DM',
      reporter_handle: 'elena',
    });
    expect(detail.audit).toHaveLength(1);
    expect(detail.audit[0]!).toMatchObject({ action: 'penalty', penalty_points: -100 });
  });

  it('reads the detail without writing anything', async () => {
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ note: null, resolution: null })] }],
      'audit_log.select': [{ data: [] }],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
      'posts.select': [{ data: [{ id: T1 }] }],
    });
    await getReportDetail(asClient(fake), R1);
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

describe('getReportDetail target resolution', () => {
  it('resolves the handle of a reported person', async () => {
    const fake = makeFakeClient({
      'reports.select': [
        {
          data: [
            reportRow({
              target_type: 'person',
              target_id: T1,
              note: null,
              resolution: null,
            }),
          ],
        },
      ],
      'audit_log.select': [{ data: [] }],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);
    expect(detail.target_type).toBe('person');
    expect(detail.target_handle).toBe('marco');
  });

  it('leaves the handle empty for a behaviour report with no target row', async () => {
    const fake = makeFakeClient({
      'reports.select': [
        {
          data: [
            reportRow({ target_type: 'behavior', target_id: null, note: null, resolution: null }),
          ],
        },
      ],
      'audit_log.select': [{ data: [] }],
      'profiles.select': [{ data: [] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);
    expect(detail.target_handle).toBeNull();
  });
});

// ── the arms that decide what a moderator actually sees ──────────────────────
// Everything below covers a branch that no earlier test reaches: the resolved-bucket
// widening, the limit+1 probe row, the reporter/target `?? null` arms and the audit `?? []`.
describe('getReportQueue — the resolved bucket and the page probe', () => {
  it("'resolved' widens to the two terminal statuses, not a status of its own", async () => {
    // There is no 'resolved' row in the table; asking for it must widen to upheld+dismissed
    // or the resolved tab renders permanently empty.
    const fake = makeFakeClient({ 'reports.select': [{ data: [] }] });
    await getReportQueue(asClient(fake), { status: 'resolved' });
    expect(fake.calls[0]!.filters).toContainEqual(['in', 'status', ['upheld', 'dismissed']]);
  });

  it('a null payload is an empty queue, not a crash', async () => {
    const fake = makeFakeClient({ 'reports.select': [{ data: null }] });
    await expect(getReportQueue(asClient(fake), { status: 'open' })).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
  });

  it('reads one row beyond the page to decide hasMore, and does not return it', async () => {
    // limit+1 is how the cursor is derived; leaking the probe row would show a moderator the
    // same item twice across two pages. Both fixtures share created_at, so a leak is visible
    // in the cursor as well as in the rows.
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ id: R1 }), reportRow({ id: R2 })] }],
    });
    const page = await getReportQueue(asClient(fake), {
      status: 'open',
      limit: 1,
    });
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 2]);
    expect(page.rows.map((r) => r.id)).toEqual([R1]);
    expect(page.nextCursor).toBe(`2026-08-01T10:00:00Z|${R1}`);
  });

  it('a report whose reporter is not joinable shows no handle rather than throwing', async () => {
    // The reporter join comes back null when that profile is blocked or deleted.
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ reporter: null })] }],
    });
    const page = await getReportQueue(asClient(fake), { status: 'open' });
    expect(page.rows[0]!.reporter_handle).toBeNull();
  });
});

describe('getReportDetail — when the target lookup is skipped', () => {
  const detailRow = (over: Record<string, unknown> = {}) =>
    reportRow({ note: null, resolution: null, ...over });

  it('skips the profile lookup entirely for a non-person report', async () => {
    // A post report has no profile to resolve; querying anyway would look the POST id up in
    // profiles, and a coincidental hit would name the wrong person in the moderation UI.
    const fake = makeFakeClient({
      'reports.select': [{ data: [detailRow({ target_type: 'post' })] }],
      'audit_log.select': [{ data: [] }],
    });
    const d = await getReportDetail(asClient(fake), R1);
    expect(d.target_handle).toBeNull();
    expect(fake.calls.some((c) => c.table === 'profiles')).toBe(false);
  });

  it('skips the profile lookup when a person report has no target id', async () => {
    const fake = makeFakeClient({
      'reports.select': [{ data: [detailRow({ target_type: 'person', target_id: null })] }],
      'audit_log.select': [{ data: [] }],
    });
    const d = await getReportDetail(asClient(fake), R1);
    expect(d.target_handle).toBeNull();
    expect(fake.calls.some((c) => c.table === 'profiles')).toBe(false);
  });

  it('a vanished target profile leaves the handle null rather than throwing', async () => {
    const fake = makeFakeClient({
      'reports.select': [{ data: [detailRow({ target_type: 'person' })] }],
      'profiles.select': [{ data: [] }],
      'audit_log.select': [{ data: [] }],
    });
    expect((await getReportDetail(asClient(fake), R1)).target_handle).toBeNull();
  });

  it('an empty audit trail is an empty array, not a crash', async () => {
    const fake = makeFakeClient({
      'reports.select': [{ data: [detailRow({ target_type: 'post' })] }],
      'audit_log.select': [{ data: null }],
    });
    expect((await getReportDetail(asClient(fake), R1)).audit).toEqual([]);
  });
});
