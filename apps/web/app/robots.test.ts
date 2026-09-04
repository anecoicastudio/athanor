import { describe, expect, it } from 'vitest';
import { SITE_URL } from '@/lib/site';
import robots from './robots';

/**
 * `robots.txt` is generated, so nobody reads it before a deploy — and both ways it can be wrong
 * are silent and expensive: a `disallow` delists the marketing site from search entirely, and a
 * relative or wrong-origin `sitemap:` line means the sitemap is simply never fetched.
 */
describe('robots', () => {
  it('lets every crawler have the whole site', () => {
    // The public pages are the acquisition surface (PRD §5). A stray disallow here is invisible
    // until organic traffic goes to zero.
    expect(robots().rules).toEqual({ userAgent: '*', allow: '/' });
  });

  it('points at the sitemap with an absolute URL on the canonical origin', () => {
    // Crawlers ignore a relative `sitemap:` line and a cross-origin one. Parsed rather than
    // string-matched: `SITE_URL` is env-derived (NEXT_PUBLIC_SITE_URL, falling back to the
    // production origin), so pinning the scheme here would go red on a local override for a
    // reason that has nothing to do with robots.txt. `new URL` throws on a relative value,
    // which is the property actually worth asserting.
    const sitemap = new URL(String(robots().sitemap));
    expect(sitemap.origin).toBe(new URL(SITE_URL).origin);
    expect(sitemap.pathname).toBe('/sitemap.xml');
  });

  it('declares the canonical host', () => {
    expect(robots().host).toBe(SITE_URL);
    // A trailing slash would make the sitemap line `…//sitemap.xml`. Red here is correct.
    expect(SITE_URL.endsWith('/')).toBe(false);
  });
});
