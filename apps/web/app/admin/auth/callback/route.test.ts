import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn();

vi.mock('@/utils/supabase/server', () => ({
  createAuthedClient: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}));
vi.mock('next/server', () => ({
  NextResponse: { redirect: (url: string) => ({ kind: 'redirect', location: String(url) }) },
}));

const { GET } = await import('./route');
const { POST } = await import('../signout/route');

const ORIGIN = 'https://www.athanor.workers.dev';
const request = (path: string) =>
  ({ nextUrl: new URL(`${ORIGIN}${path}`) }) as unknown as NextRequest;

/** The mocked NextResponse.redirect returns a plain object; the routes declare NextResponse. */
const redirectOf = (res: unknown) => res as { kind: string; location: string };

beforeEach(() => {
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
});

describe('GET /admin/auth/callback', () => {
  it('exchanges the code and lands on the admin panel', async () => {
    const res = redirectOf(await GET(request('/admin/auth/callback?code=abc123')));
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(res.location).toBe(`${ORIGIN}/admin`);
  });

  it('bounces to login when there is no code at all', async () => {
    const res = redirectOf(await GET(request('/admin/auth/callback')));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.location).toBe(`${ORIGIN}/admin/login?error=auth`);
  });

  it('bounces to login when the exchange fails, never to the panel', async () => {
    // A failed exchange means no session; landing on /admin would just bounce off the
    // middleware, losing the reason.
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid grant' } });
    const res = redirectOf(await GET(request('/admin/auth/callback?code=stale')));
    expect(res.location).toBe(`${ORIGIN}/admin/login?error=auth`);
  });

  it('derives the redirect from the request origin, not from a query parameter', async () => {
    // The classic OAuth-callback open redirect: honouring ?next= / ?redirect_to= would let a
    // phishing link bounce a freshly-authenticated admin to an attacker's host.
    const res = redirectOf(
      await GET(request('/admin/auth/callback?code=abc&next=https://evil.example/steal')),
    );
    expect(res.location).toBe(`${ORIGIN}/admin`);
    expect(res.location).not.toContain('evil.example');
  });

  it('does not leak the code into the redirect target', async () => {
    const res = redirectOf(await GET(request('/admin/auth/callback?code=secret-code')));
    expect(res.location).not.toContain('secret-code');
  });
});

describe('POST /admin/auth/signout', () => {
  it('signs out and returns to the login page', async () => {
    const res = redirectOf(await POST(request('/admin/auth/signout')));
    expect(signOut).toHaveBeenCalled();
    expect(res.location).toBe(`${ORIGIN}/admin/login`);
  });

  it('is POST-only — a GET export would make sign-out CSRF-able from an <img> tag', async () => {
    const mod = await import('../signout/route');
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
  });
});
