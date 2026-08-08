import { describe, it, expect, vi } from 'vitest';
import { REPORT_PENALTY } from '@athanor/core';
import { adminReportKeys, getReportDetail, getReportQueue, resolveReport } from './admin';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';

describe('resolveReport', () => {
  it('calls resolve_report rpc with mapped points for an uphold', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as any;
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
  it('maps dismiss to dismiss/null', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await resolveReport({ rpc } as any, {
      reportId: '00000000-0000-0000-0000-000000000002',
      verdict: 'dismiss',
      resolution: 'not a violation',
    });
    expect(rpc).toHaveBeenCalledWith('resolve_report', {
      p_report_id: '00000000-0000-0000-0000-000000000002',
      p_status: 'dismissed',
      p_resolution: 'not a violation',
      p_action: 'dismiss',
      p_severity: null,
      p_penalty_points: null,
    });
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
    expect(String(or?.[1])).toContain('created_at.lt.2026-08-01T10:00:00Z');
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

describe('adminReportKeys', () => {
  it('gives each queue status and detail its own cache slot', () => {
    const keys = [
      adminReportKeys.all,
      adminReportKeys.queue('open'),
      adminReportKeys.queue('reviewing'),
      adminReportKeys.queue('resolved'),
      adminReportKeys.detail(R1),
      adminReportKeys.detail(R2),
    ];
    expect(keys.every((k) => k[0] === 'admin' && k[1] === 'reports')).toBe(true);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
  });
});
