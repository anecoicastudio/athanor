import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
  }),
}));

const { getLocale } = await import('./get-locale');

beforeEach(() => cookieStore.clear());

describe('getLocale', () => {
  it('defaults to IT — the canonical catalog', async () => {
    // i18n.md: IT is canonical. A crawler has no cookie and must get the Italian page.
    expect(await getLocale()).toBe('it');
  });

  it('returns en when the cookie says so', async () => {
    cookieStore.set('athanor_locale', 'en');
    expect(await getLocale()).toBe('en');
  });

  it('returns it when the cookie says so', async () => {
    cookieStore.set('athanor_locale', 'it');
    expect(await getLocale()).toBe('it');
  });

  it.each(['de', 'EN', 'en-GB', '', 'it,en', '../../etc/passwd'])(
    'falls back to IT for the unsupported cookie value %j',
    async (value) => {
      // The cookie is client-writable, so anything can arrive here. Only an exact 'en'
      // switches; everything else degrades to the canonical catalog rather than producing
      // a locale the catalogs have no keys for.
      cookieStore.set('athanor_locale', value);
      expect(await getLocale()).toBe('it');
    },
  );
});
