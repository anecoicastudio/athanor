import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveReport = vi.fn();
const createAuthedClient = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();

vi.mock('@athanor/api', () => ({ resolveReport: (...a: unknown[]) => resolveReport(...a) }));
vi.mock('@/utils/supabase/server', () => ({ createAuthedClient: () => createAuthedClient() }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

const { submitVerdict } = await import('./actions');

const clientAs = (role?: string) => ({
  auth: {
    getUser: async () => ({
      data: { user: role === undefined ? null : { id: 'admin-1', app_metadata: { role } } },
    }),
  },
});

const REPORT_ID = '00000000-0000-0000-0000-0000000000aa';

const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  const fields = {
    reportId: REPORT_ID,
    verdict: 'uphold',
    resolution: 'Ripetute molestie in chat.',
    severity: 'high',
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== '') fd.set(k, v);
  return fd;
};

beforeEach(() => {
  resolveReport.mockReset();
  createAuthedClient.mockReset();
  revalidatePath.mockReset();
  redirect.mockReset();
});

describe('submitVerdict — authorization', () => {
  it('refuses a signed-out caller and resolves nothing', async () => {
    createAuthedClient.mockResolvedValue(clientAs(undefined));
    await expect(submitVerdict(form())).rejects.toThrow('Forbidden');
    // A verdict that ran the RPC and *then* threw would already have penalised someone.
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('refuses an authenticated NON-admin and resolves nothing', async () => {
    createAuthedClient.mockResolvedValue(clientAs('member'));
    await expect(submitVerdict(form())).rejects.toThrow('Forbidden');
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('reads the role from app_metadata, never from user_metadata', async () => {
    // supabase.md: user_metadata is user-writable, so trusting it would let anyone
    // self-promote to moderator and hand out −50…−200 Aura penalties.
    createAuthedClient.mockResolvedValue({
      auth: {
        async getUser() {
          return {
            data: { user: { id: 'u1', app_metadata: {}, user_metadata: { role: 'admin' } } },
          };
        },
      },
    });
    await expect(submitVerdict(form())).rejects.toThrow('Forbidden');
    expect(resolveReport).not.toHaveBeenCalled();
  });
});

describe('submitVerdict — validation at the boundary', () => {
  it('rejects a malformed reportId before touching the database', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    await expect(submitVerdict(form({ reportId: 'not-a-uuid' }))).rejects.toThrow();
    expect(resolveReport).not.toHaveBeenCalled();
    // Parsing precedes the client entirely — no session round trip for junk input.
    expect(createAuthedClient).not.toHaveBeenCalled();
  });

  it('rejects a verdict outside the enum', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    await expect(submitVerdict(form({ verdict: 'ban_forever' }))).rejects.toThrow();
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('rejects upholding without a severity', async () => {
    // resolveReportInput refines this: severity drives REPORT_PENALTY (−50…−200), so an
    // uphold without one has no defined point value.
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    await expect(submitVerdict(form({ severity: '' }))).rejects.toThrow();
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('rejects a blank resolution', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    await expect(submitVerdict(form({ resolution: '   ' }))).rejects.toThrow();
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('allows dismissing without a severity', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    await submitVerdict(form({ verdict: 'dismiss', severity: '' }));
    expect(resolveReport).toHaveBeenCalledOnce();
    expect(resolveReport.mock.calls[0]![1]).toMatchObject({
      verdict: 'dismiss',
      severity: undefined,
    });
  });
});

describe('submitVerdict — the happy path', () => {
  beforeEach(() => createAuthedClient.mockResolvedValue(clientAs('admin')));

  it('passes the parsed input to resolveReport, then revalidates and redirects', async () => {
    await submitVerdict(form());
    expect(resolveReport).toHaveBeenCalledOnce();
    expect(resolveReport.mock.calls[0]![1]).toEqual({
      reportId: REPORT_ID,
      verdict: 'uphold',
      resolution: 'Ripetute molestie in chat.',
      severity: 'high',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin');
    expect(redirect).toHaveBeenCalledWith('/admin?status=open');
  });

  it('does not redirect when the RPC fails', async () => {
    // A redirect on failure would show the moderator a resolved queue for a report that is
    // still open.
    resolveReport.mockRejectedValue(new Error('rls denied'));
    await expect(submitVerdict(form())).rejects.toThrow('rls denied');
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('writes no Aura itself — the RPC delegates to the score engine (rule #1)', async () => {
    const client = clientAs('admin');
    createAuthedClient.mockResolvedValue(client);
    await submitVerdict(form());
    // The action's only database call is resolveReport; there is no ledger write path here.
    expect(resolveReport).toHaveBeenCalledWith(client, expect.anything());
  });
});
