import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser client is three lines, and all three are things that fail silently when wrong: the
 * wrong key variable produces a client that 401s every request, and a computed env read compiles
 * and ships as `undefined` because Next inlines `NEXT_PUBLIC_*` at build time.
 *
 * `@supabase/ssr` is mocked to capture what the factory was handed; `./key` is mocked because key
 * resolution is `key.test.ts`'s subject.
 */

const calls: { url: string; key: string }[] = [];
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (url: string, key: string) => {
    calls.push({ url, key });
    return { marker: 'browser-client' };
  },
}));

vi.mock('./key', () => ({ supabaseKey: () => 'sb_publishable_test' }));

const { createClient } = await import('./client');

const URL_ENV = 'NEXT_PUBLIC_SUPABASE_URL';

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv(URL_ENV, 'https://project.supabase.co');
});

afterEach(() => vi.unstubAllEnvs());

describe('createClient', () => {
  it('builds the browser client from the env URL and the resolved key', () => {
    createClient();
    expect(calls).toEqual([{ url: 'https://project.supabase.co', key: 'sb_publishable_test' }]);
  });

  it('reads the URL at call time, so a stubbed env is honoured', () => {
    vi.stubEnv(URL_ENV, 'https://other.supabase.co');
    createClient();
    expect(calls[0].url).toBe('https://other.supabase.co');
  });

  it('reads the env var as a literal member expression', () => {
    // Metro/Next inline `process.env.NEXT_PUBLIC_*` at build time; `process.env[name]` yields
    // undefined in the shipped bundle with no error pointing at the cause. Asserted from source
    // because no runtime behaviour here can distinguish the two (mobile.md, key.test.ts precedent).
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(source).not.toMatch(/process\.env\[/);
  });
});
