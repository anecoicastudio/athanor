import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscribeToWaitlist = vi.fn();
const createClient = vi.fn();

vi.mock('@athanor/api', async () => {
  // isWaitlistRateLimited is NOT mocked: it is the thing under test on this route, and a stub
  // would let a wrong predicate pass here while returning 500 in production.
  const actual = await vi.importActual<typeof import('@athanor/api')>('@athanor/api');
  return {
    isWaitlistRateLimited: actual.isWaitlistRateLimited,
    subscribeToWaitlist: (...a: unknown[]) => subscribeToWaitlist(...a),
  };
});
vi.mock('@/utils/supabase/server', () => ({
  createClient: (...a: unknown[]) => createClient(...a),
}));
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

/** What the throttle trigger raises once an address is over its budget. */
const throttled = Object.assign(new Error('waitlist_rate_limited'), { code: 'PT429' });

beforeEach(() => {
  subscribeToWaitlist.mockReset().mockResolvedValue({ duplicate: false });
  createClient.mockReset().mockResolvedValue({});
});

describe('POST /api/waitlist — honeypot', () => {
  it('a filled honeypot returns a benign success and stores NOTHING', async () => {
    // The bot must not learn it was rejected, so the response is indistinguishable from a
    // real capture — the tell would be an error status or a different body.
    const res = await post({ email: 'bot@spam.io', company: 'Acme Corp' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(subscribeToWaitlist).not.toHaveBeenCalled();
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

describe('POST /api/waitlist — capture', () => {
  it('reports a duplicate without failing', async () => {
    subscribeToWaitlist.mockResolvedValue({ duplicate: true });
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
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

describe('POST /api/waitlist — throttled (issue #23)', () => {
  it('answers 429, not 500, when the trigger refuses', async () => {
    // «Slow down» must not read as «we are broken». The route's only job in this fix is telling
    // the two apart, so this is the assertion the whole change exists for.
    subscribeToWaitlist.mockRejectedValue(throttled);
    const res = await post({ email: 'a@b.it' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('answers honestly rather than borrowing the honeypot silent-success', async () => {
    // Pretending to store a signup we rejected is the same lie as a false zero, pointing the
    // other way. The silent-success shape is for bots; a throttled human needs to know to retry.
    subscribeToWaitlist.mockRejectedValue(throttled);
    const res = await post({ email: 'a@b.it' });
    expect(res.status).not.toBe(200);
    expect(await res.json()).not.toEqual({ ok: true, duplicate: false });
  });

  it('leaks neither the raise token nor the trigger name to the caller', async () => {
    subscribeToWaitlist.mockRejectedValue(
      Object.assign(
        new Error('waitlist_rate_limited\nCONTEXT: athanor.waitlist_throttle_check()'),
        {
          code: 'PT429',
        },
      ),
    );
    const body = await (await post({ email: 'a@b.it' })).text();
    expect(body).not.toContain('waitlist_rate_limited');
    expect(body).not.toContain('waitlist_throttle_check');
  });

  it('a plain P0001 from some other check is still a 500', async () => {
    // Any `raise exception` without an explicit errcode is P0001, which is exactly why the
    // trigger uses PT429 instead. Answering 429 to one of these would tell a member to slow
    // down when nothing was too fast.
    subscribeToWaitlist.mockRejectedValue(
      Object.assign(new Error('waitlist_rate_limited'), { code: 'P0001' }),
    );
    expect((await post({ email: 'a@b.it' })).status).toBe(500);
  });

  it('forwards the visitor address so the trigger keys on them, not on this function', async () => {
    // Without this the insert carries only the Vercel function's egress IP and the per-client
    // budget is silently a site-wide one, with real visitors throttling each other off.
    await POST({
      json: async () => ({ email: 'a@b.it' }),
      headers: { get: (k: string) => (k === 'x-forwarded-for' ? '203.0.113.7, 70.41.3.18' : null) },
    } as unknown as Request);
    expect(createClient).toHaveBeenCalledWith('203.0.113.7');
  });

  it('does not reach the database on a honeypot hit or a malformed body', async () => {
    // Both return before the insert, so a bot cannot spend a real address's budget.
    await post({ email: 'bot@spam.io', company: 'Acme Corp' });
    await post({ email: 'not-an-email' });
    expect(subscribeToWaitlist).not.toHaveBeenCalled();
  });
});

describe('POST /api/waitlist — the operator email is gone (issue #23)', () => {
  it('sends nothing, even with a Resend key in the environment', async () => {
    // One send per non-duplicate signup meant a script with a fresh address each time
    // mailbombed the inbox and burned the quota, and the duplicate check was no defence
    // because the attacker never repeats an address. Capping it would have been weaker than
    // removing it. This test is the guard against it coming back by reflex.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    try {
      const res = await post({ email: 'a@b.it' });
      expect(res.status).toBe(200);
      expect(subscribeToWaitlist).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
