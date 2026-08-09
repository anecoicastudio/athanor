import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getUser = vi.fn();
const getSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser, getSession } }),
}));
vi.mock('./key', () => ({ supabaseKey: () => 'sb_publishable_test' }));
vi.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ kind: 'next', cookies: { set: () => {} } }),
    redirect: (url: URL | string) => ({ kind: 'redirect', location: String(url) }),
  },
}));

const { updateSession } = await import('./middleware');

/** Minimal NextRequest stand-in: the middleware only touches nextUrl and cookies. */
function request(path: string): NextRequest {
  const nextUrl = new URL(`https://athanor-page.vercel.app${path}`) as URL & {
    clone: () => URL;
  };
  nextUrl.clone = function clone() {
    return Object.assign(new URL(this.href), { clone });
  };
  return { nextUrl, cookies: { getAll: () => [], set: () => {} } } as unknown as NextRequest;
}

/** The mocked NextResponse returns plain objects; updateSession declares NextResponse. */
const gate = async (path: string) =>
  (await updateSession(request(path))) as unknown as { kind: string; location?: string };

const asUser = (role?: string) => ({
  data: { user: role === undefined ? null : { id: 'u1', app_metadata: { role } } },
});

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(asUser(undefined));
  getSession.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
});

describe('updateSession — the admin gate', () => {
  it('sends a signed-out visitor on /admin to the login page', async () => {
    const res = await gate('/admin');
    expect(res.kind).toBe('redirect');
    expect(res.location).toContain('/admin/login');
  });

  it('sends an authenticated NON-admin to the login page', async () => {
    // Being signed in is not being a moderator — this queue shows reported content.
    getUser.mockResolvedValue(asUser('member'));
    expect((await gate('/admin')).kind).toBe('redirect');
  });

  it('lets an admin through', async () => {
    getUser.mockResolvedValue(asUser('admin'));
    expect((await gate('/admin')).kind).toBe('next');
  });

  it('gates the nested admin routes too, not just /admin itself', async () => {
    for (const path of ['/admin/reports/abc', '/admin/waitlist', '/admin/waitlist/export']) {
      expect((await gate(path)).kind, path).toBe('redirect');
    }
  });

  it('reads the role from app_metadata, never from user_metadata', async () => {
    // user_metadata is user-writable: trusting it would let anyone into the moderation panel.
    getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: {}, user_metadata: { role: 'admin' } } },
    });
    expect((await gate('/admin')).kind).toBe('redirect');
  });

  it('uses getUser, never getSession', async () => {
    // web.md: getSession reads the cookie without verifying it, so it is forgeable.
    await gate('/admin');
    expect(getUser).toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('updateSession — routes that must NOT be gated', () => {
  it('does not redirect /admin/login (that would be a loop)', async () => {
    expect((await gate('/admin/login')).kind).toBe('next');
  });

  it('does not redirect /admin/auth/callback (that would break sign-in)', async () => {
    // The callback is where the session is established, so it necessarily runs signed-out.
    expect((await gate('/admin/auth/callback?code=x')).kind).toBe('next');
  });

  it.each(['/', '/privacy', '/terms', '/@luna', '/invite/abc'])(
    'leaves the public route %s alone for a signed-out visitor',
    async (path) => {
      expect((await gate(path)).kind).toBe('next');
    },
  );

  it('does not gate a path that merely contains the letters "admin"', async () => {
    // A handle like @administrator is a public profile, not the panel.
    expect((await gate('/@administrator')).kind).toBe('next');
  });
});
