import { describe, it, expect, vi } from 'vitest';
import { resolveReport } from './admin';

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
