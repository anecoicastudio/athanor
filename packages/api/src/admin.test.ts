import { describe, it, expect, vi } from 'vitest';
import { REPORT_PENALTY } from '@athanor/core';
import {
  getEditionAuditTrail,
  getFundEdition,
  getFundEditionIndex,
  getReportDetail,
  getReportQueue,
  getWaitlistCount,
  getWaitlistPage,
  resolveReport,
  WAITLIST_PAGE_CEILING,
} from './admin';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
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

  // #106 — the enforcement actions. severity/points travel only with a penalty; the
  // suspend-until arithmetic runs against the injected clock, never the wall clock.
  it('maps a suspend to p_suspend_until = now + suspendDays', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const now = () => new Date('2026-08-13T12:00:00.000Z');
    await resolveReport(
      { rpc } as unknown as AthanorClient,
      {
        reportId: '00000000-0000-0000-0000-000000000004',
        verdict: 'uphold',
        action: 'suspend',
        resolution: 'ripetute molestie',
        suspendDays: 7,
      },
      now,
    );
    expect(rpc).toHaveBeenCalledWith('resolve_report', {
      p_report_id: '00000000-0000-0000-0000-000000000004',
      p_status: 'upheld',
      p_resolution: 'ripetute molestie',
      p_action: 'suspend',
      p_suspend_until: '2026-08-20T12:00:00.000Z',
    });
  });
  it('maps ban and warn with no severity, points or until', async () => {
    for (const action of ['ban', 'warn'] as const) {
      const rpc = vi.fn().mockResolvedValue({ error: null });
      await resolveReport({ rpc } as unknown as AthanorClient, {
        reportId: '00000000-0000-0000-0000-000000000005',
        verdict: 'uphold',
        action,
        resolution: 'x',
      });
      expect(rpc).toHaveBeenCalledWith('resolve_report', {
        p_report_id: '00000000-0000-0000-0000-000000000005',
        p_status: 'upheld',
        p_resolution: 'x',
        p_action: action,
      });
    }
  });
  it('refuses a suspend with no suspendDays rather than sending an endless suspension', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await expect(
      resolveReport({ rpc } as unknown as AthanorClient, {
        reportId: '00000000-0000-0000-0000-000000000006',
        verdict: 'uphold',
        action: 'suspend',
        resolution: 'x',
      }),
    ).rejects.toThrow(/requires suspendDays/);
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
  // edition_id / candidacy_id are nullable but not optional on auditLogRow — a moderation
  // row carries them as null, and omitting them fails the parse the reader now performs.
  const auditRow = {
    id: '00000000-0000-0000-0000-0000000000e1',
    report_id: R1,
    actor_id: '00000000-0000-0000-0000-0000000000f1',
    action: 'penalty',
    penalty_points: -100,
    reason: 'breaks the ethical guidelines',
    created_at: '2026-08-02T09:00:00Z',
    edition_id: null,
    candidacy_id: null,
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
    expect(detail.auditExcluded).toBe(0);
  });

  it('withholds a row the schema rejects instead of typing it as valid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ note: null, resolution: null })] }],
      'audit_log.select': [
        {
          data: [
            auditRow,
            // A vocabulary the schema has not learned — #392's failure mode, the one the
            // cast let through typed as an AuditLogAction.
            { ...auditRow, id: '00000000-0000-0000-0000-0000000000e2', action: 'unmapped_action' },
          ],
        },
      ],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
      'posts.select': [{ data: [{ id: T1 }] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);

    expect(detail.audit).toHaveLength(1);
    expect(detail.audit[0]!.action).toBe('penalty');
    expect(detail.auditExcluded).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('00000000-0000-0000-0000-0000000000e2');
    warn.mockRestore();
  });

  it('withholds a fund row whose shape the refinement forbids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ note: null, resolution: null })] }],
      'audit_log.select': [
        {
          data: [
            // A fund action carrying a report and penalty points: the enum admits the
            // action, only audit_log_fund_shape rejects the row. The cast admitted both.
            {
              ...auditRow,
              id: '00000000-0000-0000-0000-0000000000e3',
              action: 'verify_phase',
              edition_id: null,
            },
          ],
        },
      ],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
      'posts.select': [{ data: [{ id: T1 }] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);

    expect(detail.audit).toEqual([]);
    expect(detail.auditExcluded).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reports nothing withheld when the trail is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'reports.select': [{ data: [reportRow({ note: null, resolution: null })] }],
      'audit_log.select': [{ data: [] }],
      'profiles.select': [{ data: [{ handle: 'marco' }] }],
      'posts.select': [{ data: [{ id: T1 }] }],
    });

    const detail = await getReportDetail(asClient(fake), R1);

    expect(detail.audit).toEqual([]);
    expect(detail.auditExcluded).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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

// ---------------------------------------------------------------------------
// The fund audit trail (#432). Written by thirteen transitions since #219 and read by
// nothing until now: `getReportDetail` filters `report_id`, and `audit_log_fund_shape`
// forbids a fund row from carrying one, so the two halves are mutually exclusive by CHECK.
// ---------------------------------------------------------------------------

const E1 = '00000000-0000-0000-0000-0000000000a1';
const E2 = '00000000-0000-0000-0000-0000000000a2';
const A1 = '00000000-0000-0000-0000-0000000000b1';
const A2 = '00000000-0000-0000-0000-0000000000b2';

const editionRow = (over: Record<string, unknown> = {}) => ({
  id: E1,
  phase: 'realization',
  target_at: '2026-09-01T00:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  closure_reason: null,
  winner_candidacy_id: null,
  ...over,
});

// A fund audit row: no report, no penalty points, an edition — the shape
// `audit_log_fund_shape` demands and `auditLogRow`'s refinement mirrors.
const fundAuditRow = (over: Record<string, unknown> = {}) => ({
  id: A1,
  report_id: null,
  actor_id: null,
  action: 'declare_winner',
  penalty_points: null,
  reason: 'ballot closed, quorum met',
  created_at: '2026-08-05T09:00:00Z',
  edition_id: E1,
  candidacy_id: null,
  ...over,
});

describe('getFundEditionIndex', () => {
  it('lists the cycles newest first, parsed rather than cast', async () => {
    const fake = makeFakeClient({
      'fund_editions.select': [
        { data: [editionRow(), editionRow({ id: E2, created_at: '2026-05-01T10:00:00Z' })] },
      ],
    });
    const page = await getFundEditionIndex(asClient(fake));
    expect(page.rows.map((r) => r.id)).toEqual([E1, E2]);
    expect(page.excluded).toBe(0);
    expect(fake.calls[0]!.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(fake.calls[0]!.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
  });

  it('reads one row beyond the page to decide hasMore, and does not return it', async () => {
    const fake = makeFakeClient({
      'fund_editions.select': [
        { data: [editionRow(), editionRow({ id: E2, created_at: '2026-05-01T10:00:00Z' })] },
      ],
    });
    const page = await getFundEditionIndex(asClient(fake), { limit: 1 });
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 2]);
    expect(page.rows.map((r) => r.id)).toEqual([E1]);
    expect(page.nextCursor).toBe(`2026-08-01T10:00:00Z|${E1}`);
  });

  it('derives the cursor from the raw page tail, so a withheld row cannot overlap the next page', async () => {
    // The tail row is unparseable. Taking the cursor from the last PARSED row would move it
    // backwards and serve this page's rows again on the next one — showing the operator the
    // same cycle twice while still hiding the bad one.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'fund_editions.select': [
        {
          data: [
            editionRow({ phase: 'not_a_phase' }),
            editionRow({ id: E2, created_at: '2026-05-01T10:00:00Z' }),
          ],
        },
      ],
    });
    const page = await getFundEditionIndex(asClient(fake), { limit: 1 });
    expect(page.rows).toEqual([]);
    expect(page.excluded).toBe(1);
    expect(page.nextCursor).toBe(`2026-08-01T10:00:00Z|${E1}`);
    expect(warn.mock.calls[0]![0]).toContain(E1);
    warn.mockRestore();
  });

  it('pages by keyset, never by offset', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: [] }] });
    await getFundEditionIndex(asClient(fake), { cursor: `2026-08-01T10:00:00Z|${E1}` });
    expect(fake.calls[0]!.filters).toContainEqual([
      'or',
      `created_at.lt.2026-08-01T10:00:00Z,and(created_at.eq.2026-08-01T10:00:00Z,id.lt.${E1})`,
    ]);
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
  });

  it('refuses a half cursor rather than silently restarting at page one', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: [] }] });
    await expect(
      getFundEditionIndex(asClient(fake), { cursor: '2026-08-01T10:00:00Z' }),
    ).rejects.toThrow(/malformed fund edition cursor/);
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ error: DB_DOWN }] });
    await expect(getFundEditionIndex(asClient(fake))).rejects.toEqual(DB_DOWN);
  });

  it('a null payload is an empty index, not a crash', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: null }] });
    await expect(getFundEditionIndex(asClient(fake))).resolves.toEqual({
      rows: [],
      excluded: 0,
      nextCursor: null,
    });
  });

  it('reads the index without writing anything', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: [editionRow()] }] });
    await getFundEditionIndex(asClient(fake));
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

describe('getEditionAuditTrail', () => {
  it('reads one cycle’s trail, keyed on the edition rather than on a report', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ data: [fundAuditRow()] }] });
    const page = await getEditionAuditTrail(asClient(fake), E1);
    expect(fake.calls[0]!.filters).toContainEqual(['eq', 'edition_id', E1]);
    expect(fake.calls[0]!.filters.some((f) => f[1] === 'report_id')).toBe(false);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!).toMatchObject({ action: 'declare_winner', edition_id: E1 });
    expect(page.excluded).toBe(0);
  });

  it('withholds a row whose action the schema has not learned, and says how many', async () => {
    // #392's failure mode, on the fund half this time: a fourteenth transition added to the
    // CHECK and not to AUDIT_LOG_FUND_ACTIONS. The trail stays up, one row short and honest.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'audit_log.select': [
        { data: [fundAuditRow(), fundAuditRow({ id: A2, action: 'unmapped_transition' })] },
      ],
    });
    const page = await getEditionAuditTrail(asClient(fake), E1);
    expect(page.rows).toHaveLength(1);
    expect(page.excluded).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(A2);
    warn.mockRestore();
  });

  it('withholds a fund row the shape refinement forbids', async () => {
    // A fund action carrying a report id: the enum admits the action, only
    // `audit_log_fund_shape` (and its Zod mirror) rejects the row.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'audit_log.select': [{ data: [fundAuditRow({ report_id: R1 })] }],
    });
    const page = await getEditionAuditTrail(asClient(fake), E1);
    expect(page.rows).toEqual([]);
    expect(page.excluded).toBe(1);
    warn.mockRestore();
  });

  it('reads one row beyond the page and derives the cursor from the raw tail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'audit_log.select': [
        {
          data: [
            fundAuditRow({ action: 'unmapped_transition' }),
            fundAuditRow({ id: A2, created_at: '2026-08-04T09:00:00Z' }),
          ],
        },
      ],
    });
    const page = await getEditionAuditTrail(asClient(fake), E1, { limit: 1 });
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 2]);
    expect(page.rows).toEqual([]);
    expect(page.excluded).toBe(1);
    expect(page.nextCursor).toBe(`2026-08-05T09:00:00Z|${A1}`);
    warn.mockRestore();
  });

  it('pages by keyset, never by offset', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ data: [] }] });
    await getEditionAuditTrail(asClient(fake), E1, { cursor: `2026-08-05T09:00:00Z|${A1}` });
    expect(fake.calls[0]!.filters).toContainEqual([
      'or',
      `created_at.lt.2026-08-05T09:00:00Z,and(created_at.eq.2026-08-05T09:00:00Z,id.lt.${A1})`,
    ]);
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
  });

  it('refuses a half cursor rather than silently restarting the trail', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ data: [] }] });
    await expect(getEditionAuditTrail(asClient(fake), E1, { cursor: `|${A1}` })).rejects.toThrow(
      /malformed edition audit cursor/,
    );
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ error: DB_DOWN }] });
    await expect(getEditionAuditTrail(asClient(fake), E1)).rejects.toEqual(DB_DOWN);
  });

  it('a null payload is an empty trail, not a crash', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ data: null }] });
    await expect(getEditionAuditTrail(asClient(fake), E1)).resolves.toEqual({
      rows: [],
      excluded: 0,
      nextCursor: null,
    });
  });

  it('reads the trail without writing anything', async () => {
    const fake = makeFakeClient({ 'audit_log.select': [{ data: [fundAuditRow()] }] });
    await getEditionAuditTrail(asClient(fake), E1);
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

describe('getFundEdition', () => {
  it('reads the cycle the audit view names its trail with', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: [editionRow()] }] });
    const found = await getFundEdition(asClient(fake), E1);
    expect(fake.calls[0]!.filters).toContainEqual(['eq', 'id', E1]);
    expect(found.row).toMatchObject({ id: E1, phase: 'realization' });
    expect(found.excluded).toBe(0);
  });

  it('separates "no such cycle" from "a cycle I could not read"', async () => {
    // The two collapse into one empty screen if the reader answers `null` to both, and the
    // collapse is #432's own defect: a cycle that has just opened has no audit rows either,
    // so a mistyped id would render as a real, quiet cycle.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const absent = makeFakeClient({ 'fund_editions.select': [{ data: [] }] });
    await expect(getFundEdition(asClient(absent), E1)).resolves.toEqual({
      row: null,
      excluded: 0,
    });

    const unreadable = makeFakeClient({
      'fund_editions.select': [{ data: [editionRow({ phase: 'not_a_phase' })] }],
    });
    await expect(getFundEdition(asClient(unreadable), E1)).resolves.toEqual({
      row: null,
      excluded: 1,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ error: DB_DOWN }] });
    await expect(getFundEdition(asClient(fake), E1)).rejects.toEqual(DB_DOWN);
  });

  it('reads the cycle without writing anything', async () => {
    const fake = makeFakeClient({ 'fund_editions.select': [{ data: [editionRow()] }] });
    await getFundEdition(asClient(fake), E1);
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

// ── waitlist ─────────────────────────────────────────────────────────────────────────────
// Both readers go through SECURITY DEFINER RPCs that re-check is_admin() server-side; this
// package is plumbing (api rule) and never gates on a client-side role.
describe('getWaitlistCount', () => {
  it('calls the admin_waitlist_count RPC with no client-supplied arguments', async () => {
    const fake = makeFakeClient({ 'rpc.admin_waitlist_count': [{ data: 42 }] });
    await expect(getWaitlistCount(asClient(fake))).resolves.toBe(42);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'rpc',
      op: 'rpc',
      columns: 'admin_waitlist_count',
    });
    // nothing the caller could use to widen the scope — the RPC derives the check itself
    expect(fake.calls[0]!.values).toBeUndefined();
  });

  it('coalesces a null count to zero', async () => {
    const fake = makeFakeClient({ 'rpc.admin_waitlist_count': [{ data: null }] });
    await expect(getWaitlistCount(asClient(fake))).resolves.toBe(0);
  });

  it('surfaces the 42501 a non-admin gets instead of reporting zero', async () => {
    const fake = makeFakeClient({
      'rpc.admin_waitlist_count': [{ error: { code: '42501', message: 'not an admin' } }],
    });
    await expect(getWaitlistCount(asClient(fake))).rejects.toThrow('not an admin');
  });
});

const W1 = '10000000-0000-4000-8000-000000000001';
const W2 = '10000000-0000-4000-8000-000000000002';
const waitlistRow = (over: Record<string, unknown> = {}) => ({
  id: W1,
  email: 'a@b.it',
  locale: 'it',
  source: 'landing-hero',
  created_at: '2026-08-01T10:00:00Z',
  ...over,
});

describe('getWaitlistPage', () => {
  it('asks the RPC for one row beyond the page, and never an offset (rule #9)', async () => {
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: [waitlistRow()] }] });
    const page = await getWaitlistPage(asClient(fake));

    expect(fake.calls[0]).toMatchObject({ op: 'rpc', columns: 'admin_list_waitlist' });
    // 25 + the probe row; no cursor halves on page one, and no range modifier ever
    expect(fake.calls[0]!.values).toEqual({ p_limit: 26 });
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
    expect(page.rows.map((r) => r.id)).toEqual([W1]);
    expect(page.excluded).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it('returns the page parsed, with source null where the column is null', async () => {
    const fake = makeFakeClient({
      'rpc.admin_list_waitlist': [{ data: [waitlistRow(), waitlistRow({ id: W2, source: null })] }],
    });
    const page = await getWaitlistPage(asClient(fake));
    expect(page.rows.map((r) => r.source)).toEqual(['landing-hero', null]);
  });

  it('reads one row beyond the page to decide hasMore, and does not return it', async () => {
    const fake = makeFakeClient({
      'rpc.admin_list_waitlist': [
        { data: [waitlistRow(), waitlistRow({ id: W2, created_at: '2026-07-01T10:00:00Z' })] },
      ],
    });
    const page = await getWaitlistPage(asClient(fake), { limit: 1 });
    expect(fake.calls[0]!.values).toEqual({ p_limit: 2 });
    expect(page.rows.map((r) => r.id)).toEqual([W1]);
    expect(page.nextCursor).toBe(`2026-08-01T10:00:00Z|${W1}`);
  });

  it('sends the cursor as the two RPC halves the keyset runs on', async () => {
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: [] }] });
    await getWaitlistPage(asClient(fake), { cursor: `2026-08-01T10:00:00Z|${W1}` });
    expect(fake.calls[0]!.values).toEqual({
      p_limit: 26,
      p_before_created_at: '2026-08-01T10:00:00Z',
      p_before_id: W1,
    });
  });

  it('refuses a half cursor rather than silently restarting at page one', async () => {
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: [] }] });
    await expect(getWaitlistPage(asClient(fake), { cursor: 'garbage' })).rejects.toThrow(
      /malformed waitlist cursor/,
    );
    await expect(
      getWaitlistPage(asClient(fake), { cursor: '2026-08-01T10:00:00Z|' }),
    ).rejects.toThrow(/malformed waitlist cursor/);
    expect(fake.calls).toEqual([]);
  });

  it('refuses a page the RPC clamp would silently cut short', async () => {
    // The function clamps p_limit to 1000 and the probe asks for limit + 1: a page of 1000
    // could never see its probe row, so a walk would end a page early with no error.
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: [] }] });
    await expect(
      getWaitlistPage(asClient(fake), { limit: WAITLIST_PAGE_CEILING + 1 }),
    ).rejects.toThrow(/out of range/);
    await expect(getWaitlistPage(asClient(fake), { limit: 0 })).rejects.toThrow(/out of range/);
    expect(fake.calls).toEqual([]);
    await expect(
      getWaitlistPage(asClient(fake), { limit: WAITLIST_PAGE_CEILING }),
    ).resolves.toBeTruthy();
    expect(fake.calls[0]!.values).toEqual({ p_limit: 1000 });
  });

  it('withholds a row the schema rejects and counts it; the cursor still comes from the raw tail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'rpc.admin_list_waitlist': [
        {
          data: [
            waitlistRow({ locale: 'fr' }),
            waitlistRow({ id: W2, created_at: '2026-07-01T10:00:00Z' }),
          ],
        },
      ],
    });
    const page = await getWaitlistPage(asClient(fake), { limit: 1 });
    expect(page.rows).toEqual([]);
    expect(page.excluded).toBe(1);
    expect(page.nextCursor).toBe(`2026-08-01T10:00:00Z|${W1}`);
    // the warning names the row by id — and never by address
    expect(warn.mock.calls[0]![0]).toContain(W1);
    expect(warn.mock.calls[0]![0]).not.toContain('a@b.it');
    warn.mockRestore();
  });

  it('surfaces the 42501 a non-admin gets instead of an empty page', async () => {
    const fake = makeFakeClient({
      'rpc.admin_list_waitlist': [{ error: { code: '42501', message: 'not an admin' } }],
    });
    await expect(getWaitlistPage(asClient(fake))).rejects.toThrow('not an admin');
  });

  it('a null payload is an empty page, not a crash', async () => {
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: null }] });
    await expect(getWaitlistPage(asClient(fake))).resolves.toEqual({
      rows: [],
      excluded: 0,
      nextCursor: null,
    });
  });

  it('reads without writing anything', async () => {
    const fake = makeFakeClient({ 'rpc.admin_list_waitlist': [{ data: [waitlistRow()] }] });
    await getWaitlistPage(asClient(fake));
    expect(fake.calls.every((c) => c.op === 'rpc')).toBe(true);
  });
});
