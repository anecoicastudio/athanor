import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { reportKeys, submitReport } from './reports';

const REPORTER = '00000000-0000-0000-0000-000000000001';
const TARGET = '00000000-0000-0000-0000-0000000000b1';
const REPORT_ID = '00000000-0000-0000-0000-0000000000c1';

/** A DB row as PostgREST returns it — must pass reportSchema.parse. */
const BASE_ROW = {
  id: REPORT_ID,
  reporter_id: REPORTER,
  target_type: 'person' as const,
  target_id: TARGET,
  category: 'spam' as const,
  note: null,
  status: 'open' as const,
  created_at: '2026-01-02T00:00:00Z',
};

/** Thenable PostgREST-builder stub: records calls; single() resolves { data, error }. */
function stub(row: Record<string, unknown> | null = BASE_ROW, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['insert', 'select']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return Promise.resolve({ data: row, error });
  };
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('reportKeys', () => {
  it('mine factory shape', () => {
    expect(reportKeys.all).toEqual(['reports']);
    expect(reportKeys.mine()).toEqual(['reports', 'mine']);
  });
});

describe('submitReport', () => {
  it('maps camelCase input to snake_case insert columns', async () => {
    const { client, calls } = stub();
    await submitReport(client, {
      targetType: 'person',
      targetId: TARGET,
      category: 'spam',
    });
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({
      target_type: 'person',
      target_id: TARGET,
      category: 'spam',
      note: null,
    });
  });

  it('coerces undefined targetId to target_id null (behavior reports)', async () => {
    const { client, calls } = stub({ ...BASE_ROW, target_type: 'behavior', target_id: null });
    await submitReport(client, { targetType: 'behavior', category: 'other' });
    const insert = calls.find((c) => c.method === 'insert');
    expect((insert?.arg as { target_id: unknown }).target_id).toBeNull();
  });

  it('trims the note before inserting', async () => {
    const { client, calls } = stub({ ...BASE_ROW, note: 'x' });
    await submitReport(client, {
      targetType: 'person',
      targetId: TARGET,
      category: 'spam',
      note: '  x  ',
    });
    const insert = calls.find((c) => c.method === 'insert');
    expect((insert?.arg as { note: unknown }).note).toBe('x');
  });

  it('turns a whitespace-only note into null (trim-then-|| null)', async () => {
    const { client, calls } = stub();
    await submitReport(client, {
      targetType: 'person',
      targetId: TARGET,
      category: 'spam',
      note: '   ',
    });
    const insert = calls.find((c) => c.method === 'insert');
    expect((insert?.arg as { note: unknown }).note).toBeNull();
  });

  it('never sends reporter_id or status — both are server-pinned', async () => {
    const { client, calls } = stub();
    await submitReport(client, { targetType: 'person', targetId: TARGET, category: 'spam' });
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).not.toHaveProperty('reporter_id');
    expect(insert?.arg).not.toHaveProperty('status');
  });

  it('returns the parsed report row', async () => {
    const { client } = stub();
    const report = await submitReport(client, {
      targetType: 'person',
      targetId: TARGET,
      category: 'spam',
    });
    expect(report).toEqual(BASE_ROW);
  });

  it('throws when the insert errors', async () => {
    const boom = new Error('rls denied');
    const { client } = stub(null, boom);
    await expect(
      submitReport(client, { targetType: 'person', targetId: TARGET, category: 'spam' }),
    ).rejects.toThrow('rls denied');
  });
});
