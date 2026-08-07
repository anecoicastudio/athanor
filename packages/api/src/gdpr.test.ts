import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { getLatestExportJob, requestErasure, requestExport } from './gdpr';

const ME = '00000000-0000-0000-0000-000000000001';

/** A gdpr_export_jobs row as PostgREST returns it — must pass gdprExportJobSchema.parse. */
const JOB_ROW = {
  id: '00000000-0000-0000-0000-0000000000f1',
  profile_id: ME,
  status: 'ready' as const,
  download_url: 'https://signed/export.zip',
  expires_at: '2026-01-09T00:00:00Z',
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
};

/** Thenable PostgREST-builder stub: records calls; maybeSingle() resolves { data, error }. */
function stub(row: Record<string, unknown> | null = null, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['maybeSingle'] = () => {
    calls.push({ method: 'maybeSingle', arg: undefined });
    return Promise.resolve({ data: row, error });
  };
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

/** Authed insert stub: records the table + insert payload; resolves { error }. */
function insertStub(user: { id: string } | null = { id: ME }, error: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ insert });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from,
  } as unknown as AthanorClient;
  return { client, from, insert };
}

describe('getLatestExportJob', () => {
  it('orders (created_at desc, id desc), limits to 1, and uses maybeSingle', async () => {
    const { client, calls } = stub(JOB_ROW);
    await getLatestExportJob(client);
    const orders = calls.filter((c) => c.method === 'order');
    expect(orders.map((c) => c.arg)).toEqual(['created_at', 'id']);
    expect(orders.every((c) => (c.arg2 as { ascending: boolean }).ascending === false)).toBe(true);
    expect(calls.some((c) => c.method === 'limit' && c.arg === 1)).toBe(true);
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
  });

  it('parses the latest job row', async () => {
    const { client } = stub(JOB_ROW);
    await expect(getLatestExportJob(client)).resolves.toEqual(JOB_ROW);
  });

  it('passes null through when the user never requested an export', async () => {
    const { client } = stub(null);
    await expect(getLatestExportJob(client)).resolves.toBeNull();
  });

  it('throws on error', async () => {
    const { client } = stub(null, new Error('boom'));
    await expect(getLatestExportJob(client)).rejects.toThrow('boom');
  });
});

describe('requestExport', () => {
  it('throws "not authenticated" when there is no user', async () => {
    const { client, insert } = insertStub(null);
    await expect(requestExport(client)).rejects.toThrow('not authenticated');
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts only { profile_id } — status/url are server-pinned', async () => {
    const { client, from, insert } = insertStub();
    await requestExport(client);
    expect(from).toHaveBeenCalledWith('gdpr_export_jobs');
    expect(insert).toHaveBeenCalledWith({ profile_id: ME });
  });

  it('throws on insert error', async () => {
    const { client } = insertStub({ id: ME }, new Error('rls denied'));
    await expect(requestExport(client)).rejects.toThrow('rls denied');
  });
});

describe('requestErasure', () => {
  it('throws "not authenticated" when there is no user', async () => {
    const { client, insert } = insertStub(null);
    await expect(requestErasure(client)).rejects.toThrow('not authenticated');
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts only { profile_id } into gdpr_erasure_requests', async () => {
    const { client, from, insert } = insertStub();
    await requestErasure(client);
    expect(from).toHaveBeenCalledWith('gdpr_erasure_requests');
    expect(insert).toHaveBeenCalledWith({ profile_id: ME });
  });

  it('throws on insert error', async () => {
    const { client } = insertStub({ id: ME }, new Error('rls denied'));
    await expect(requestErasure(client)).rejects.toThrow('rls denied');
  });
});
