import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const subscribeToWaitlist = vi.fn();
const createClient = vi.fn();

vi.mock('@athanor/api', () => ({
  subscribeToWaitlist: (...a: unknown[]) => subscribeToWaitlist(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createClient: () => createClient() }));
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  },
}));

const { POST } = await import('./route');

const post = (body: unknown) => POST({ json: async () => body } as unknown as Request);

/** A request whose body is not JSON at all — `req.json()` rejects. */
const postBroken = () =>
  POST({
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  } as unknown as Request);

const fetchMock = vi.fn();

beforeEach(() => {
  subscribeToWaitlist.mockReset().mockResolvedValue({ duplicate: false });
  createClient.mockReset().mockResolvedValue({});
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('RESEND_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/waitlist — honeypot', () => {
  it('a filled honeypot returns a benign success and stores NOTHING', async () => {
    // The bot must not learn it was rejected, so the response is indistinguishable from a
    // real capture — the tell would be an error status or a different body.
    const res = await post({ email: 'bot@spam.io', company: 'Acme Corp' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(subscribeToWaitlist).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an EMPTY honeypot field is a human and still subscribes', async () => {
    // The field is present on every submission; only a non-blank value is a bot.
    await post({ email: 'a@b.it', company: '' });
    expect(subscribeToWaitlist).toHaveBeenCalledOnce();
  });

  it('a whitespace-only honeypot is treated as empty', async () => {
    await post({ email: 'a@b.it', company: '   ' });
    expect(subscribeToWaitlist).toHaveBeenCalledOnce();
  });

  it('a non-string honeypot does not trip the trap', async () => {
    await post({ email: 'a@b.it', company: 123 });
    expect(subscribeToWaitlist).toHaveBeenCalledOnce();
  });

  it('the honeypot value never reaches the database', async () => {
    // waitlistInsertSchema strips unknown keys; assert it rather than trusting it.
    await post({ email: 'a@b.it', company: '' });
    expect(subscribeToWaitlist.mock.calls[0]![1]).not.toHaveProperty('company');
  });
});

describe('POST /api/waitlist — validation', () => {
  it('rejects a malformed email with 400 and stores nothing', async () => {
    const res = await post({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(subscribeToWaitlist).not.toHaveBeenCalled();
  });

  it('rejects a missing body with 400', async () => {
    expect((await post(null)).status).toBe(400);
    expect(subscribeToWaitlist).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400 rather than throwing', async () => {
    expect((await postBroken()).status).toBe(400);
  });

  it('rejects a locale outside the catalog', async () => {
    expect((await post({ email: 'a@b.it', locale: 'de' })).status).toBe(400);
  });

  it('normalizes the email (trimmed, lowercased) before storing', async () => {
    await post({ email: '  MiXeD@Case.IT  ' });
    expect(subscribeToWaitlist.mock.calls[0]![1]).toMatchObject({ email: 'mixed@case.it' });
  });

  it('defaults the locale to IT, the canonical catalog', async () => {
    await post({ email: 'a@b.it' });
    expect(subscribeToWaitlist.mock.calls[0]![1]).toMatchObject({ locale: 'it' });
  });
});

describe('POST /api/waitlist — capture and notify', () => {
  it('reports a duplicate without failing', async () => {
    subscribeToWaitlist.mockResolvedValue({ duplicate: true });
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
  });

  it('does not re-notify on a duplicate', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    subscribeToWaitlist.mockResolvedValue({ duplicate: true });
    await post({ email: 'a@b.it' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the notify entirely when RESEND_API_KEY is unset — capture still succeeds', async () => {
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(200);
    expect(subscribeToWaitlist).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies through Resend when the key is set', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    await post({ email: 'a@b.it' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
  });

  it('a failing notify does not lose the capture', async () => {
    // The signup is the product; the email is a convenience. Losing a waitlist row because
    // Resend is down would be the wrong trade.
    vi.stubEnv('RESEND_API_KEY', 're_test');
    fetchMock.mockRejectedValue(new Error('resend down'));
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
  });

  it('a database failure is a 500, not a silent success', async () => {
    subscribeToWaitlist.mockRejectedValue(new Error('rls denied'));
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server' });
  });

  it('never leaks the database error text to the caller', async () => {
    subscribeToWaitlist.mockRejectedValue(new Error('duplicate key value violates ...'));
    expect(await (await post({ email: 'a@b.it' })).text()).not.toContain('duplicate key');
  });
});
