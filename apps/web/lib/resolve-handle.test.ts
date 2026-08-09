import { describe, expect, it } from 'vitest';
import { resolveHandle } from './resolve-handle';

/**
 * `/@handle` is the public profile route. The leading `@` is load-bearing: without it every
 * one-segment path (/privacy, /terms, /admin) would be treated as a profile lookup.
 */
describe('resolveHandle', () => {
  it('strips the @ and returns the bare handle', () => {
    expect(resolveHandle('@luna')).toBe('luna');
  });

  it('lowercases, so /@Luna and /@luna are the same profile', () => {
    expect(resolveHandle('@LUNA')).toBe('luna');
  });

  it('decodes a percent-encoded segment before matching', () => {
    // Next gives the raw segment; %40 is how some clients encode '@'.
    expect(resolveHandle('%40luna')).toBe('luna');
  });

  it.each(['privacy', 'terms', 'admin', 'sitemap.xml'])(
    'refuses %j — a bare segment is not a profile',
    (segment) => {
      expect(resolveHandle(segment)).toBeNull();
    },
  );

  it('refuses a bare @', () => {
    expect(resolveHandle('@')).toBeNull();
  });

  it('refuses a handle the schema rejects rather than passing it to the query', () => {
    // handleSchema is the single validation source; this route must not widen it.
    expect(resolveHandle('@no spaces')).toBeNull();
    expect(resolveHandle('@punto.punto')).toBeNull();
  });

  it('refuses an over-long handle', () => {
    expect(resolveHandle(`@${'a'.repeat(200)}`)).toBeNull();
  });

  it('does not throw on a malformed percent-encoding', () => {
    // A crawler hitting /%E0%A4%A can otherwise 500 the route via decodeURIComponent.
    expect(() => resolveHandle('%E0%A4%A')).not.toThrow();
  });
});
