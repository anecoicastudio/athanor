import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three server-side Supabase factories differ only in their cookie jar, and that difference is
 * load-bearing rather than cosmetic — so it is what these tests assert:
 *
 * - `createClient` reads the request's cookies and refuses to write them.
 * - `createAnonClient` never touches `cookies()` at all. Calling it would opt the public pages back
 *   into dynamic rendering, which is the regression the function exists to prevent, and no
 *   behavioural test of the returned client could ever notice.
 * - `createAuthedClient` writes, and swallows the read-only throw a Server Component raises.
 *
 * `@supabase/ssr` is mocked so the assertions can read the options object each factory builds;
 * `./key` is mocked because key resolution is `key.test.ts`'s subject, not this file's.
 */

type CookieRow = { name: string; value: string };
type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };
type CookieMethods = { getAll: () => CookieRow[]; setAll: (c: CookieToSet[]) => void };
type ServerOptions = { cookies: CookieMethods; global?: { headers: Record<string, string> } };

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
/** Server Components get a read-only cookie store; this makes the mock behave like one. */
let jarIsReadOnly = false;
let cookiesCalls = 0;

vi.mock('next/headers', () => ({
  cookies: async () => {
    cookiesCalls += 1;
    return {
      getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        if (jarIsReadOnly) throw new Error('Cookies can only be modified in a Server Action');
        jar.set(name, { value, options });
      },
    };
  },
}));

const calls: { url: string; key: string; options: ServerOptions }[] = [];
vi.mock('@supabase/ssr', () => ({
  createServerClient: (url: string, key: string, options: ServerOptions) => {
    calls.push({ url, key, options });
    return { marker: 'server-client' };
  },
}));

vi.mock('./key', () => ({ supabaseKey: () => 'sb_publishable_test' }));

const { createClient, createAnonClient, createAuthedClient } = await import('./server');

const URL_ENV = 'NEXT_PUBLIC_SUPABASE_URL';
const lastCall = () => calls[calls.length - 1];

beforeEach(() => {
  jar.clear();
  jarIsReadOnly = false;
  cookiesCalls = 0;
  calls.length = 0;
  vi.stubEnv(URL_ENV, 'https://project.supabase.co');
});

afterEach(() => vi.unstubAllEnvs());

describe('createClient', () => {
  it('builds the client from the env URL and the resolved key', async () => {
    await createClient();
    expect(lastCall().url).toBe('https://project.supabase.co');
    expect(lastCall().key).toBe('sb_publishable_test');
  });

  it('hands PostgREST the request cookies', async () => {
    jar.set('sb-access-token', { value: 'token-a' });
    jar.set('athanor_locale', { value: 'en' });
    await createClient();
    expect(lastCall().options.cookies.getAll()).toEqual([
      { name: 'sb-access-token', value: 'token-a' },
      { name: 'athanor_locale', value: 'en' },
    ]);
  });

  it('never writes a cookie back', async () => {
    // The public pages are cached; a client that could set an auth cookie here would let one
    // viewer's session leak into a shared render.
    await createClient();
    lastCall().options.cookies.setAll([{ name: 'sb-access-token', value: 'stolen' }]);
    expect(jar.size).toBe(0);
  });

  it('forwards the visitor address when the caller passes one', async () => {
    // Issue #23: the throttle keys on the visitor. This client runs inside the Worker, so without
    // this header PostgREST sees the Worker's egress IP and one region throttles the whole site.
    await createClient('203.0.113.7');
    expect(lastCall().options.global?.headers).toEqual({ 'x-forwarded-for': '203.0.113.7' });
  });

  it('omits the global override entirely when no address is passed', async () => {
    // Not the same as an empty header: an empty `x-forwarded-for` would still override whatever
    // the transport supplies.
    await createClient();
    expect(lastCall().options.global).toBeUndefined();
  });

  it('throws when the URL is unset, naming the variable', async () => {
    vi.stubEnv(URL_ENV, '');
    await expect(createClient()).rejects.toThrow(URL_ENV);
  });
});

describe('createAnonClient', () => {
  it('does not touch cookies() — that is the whole reason it exists', () => {
    // `cookies()` throws outside a request scope (generateStaticParams, sitemap) and otherwise
    // marks the route dynamic. Reintroducing it here would re-server-render the public site.
    createAnonClient();
    expect(cookiesCalls).toBe(0);
  });

  it('presents an empty cookie jar, so PostgREST resolves the anon role', () => {
    jar.set('sb-access-token', { value: 'token-a' });
    createAnonClient();
    expect(lastCall().options.cookies.getAll()).toEqual([]);
  });

  it('persists nothing on setAll', () => {
    createAnonClient();
    lastCall().options.cookies.setAll([{ name: 'sb-access-token', value: 'nope' }]);
    expect(jar.size).toBe(0);
  });

  it('builds the client from the env URL and the resolved key', () => {
    createAnonClient();
    expect(lastCall().url).toBe('https://project.supabase.co');
    expect(lastCall().key).toBe('sb_publishable_test');
  });

  it('throws when the URL is unset, naming the variable', () => {
    vi.stubEnv(URL_ENV, '');
    expect(() => createAnonClient()).toThrow(URL_ENV);
  });
});

describe('createAuthedClient', () => {
  it('reads the request cookies', async () => {
    jar.set('sb-access-token', { value: 'token-a' });
    await createAuthedClient();
    expect(lastCall().options.cookies.getAll()).toEqual([
      { name: 'sb-access-token', value: 'token-a' },
    ]);
  });

  it('writes every refreshed cookie back, options included', async () => {
    await createAuthedClient();
    lastCall().options.cookies.setAll([
      { name: 'sb-access-token', value: 'fresh', options: { httpOnly: true } },
      { name: 'sb-refresh-token', value: 'fresh-r' },
    ]);
    expect(jar.get('sb-access-token')).toEqual({ value: 'fresh', options: { httpOnly: true } });
    expect(jar.get('sb-refresh-token')).toEqual({ value: 'fresh-r', options: undefined });
  });

  it('swallows the read-only throw a Server Component raises', async () => {
    // Nothing refreshes the session on this path any more (no Node middleware on Workers), so an
    // expired token must fall through to the /admin/login redirect — not crash the render.
    jarIsReadOnly = true;
    await createAuthedClient();
    expect(() =>
      lastCall().options.cookies.setAll([{ name: 'sb-access-token', value: 'fresh' }]),
    ).not.toThrow();
    expect(jar.size).toBe(0);
  });

  it('throws when the URL is unset, naming the variable', async () => {
    vi.stubEnv(URL_ENV, '');
    await expect(createAuthedClient()).rejects.toThrow(URL_ENV);
  });
});
