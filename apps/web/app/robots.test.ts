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
    // Crawlers ignore a relative `sitemap:` line and a cross-origin one.
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(String(robots().sitemap)).toMatch(/^https:\/\//);
  });

  it('declares the canonical host', () => {
    expect(robots().host).toBe(SITE_URL);
    expect(SITE_URL.endsWith('/')).toBe(false);
  });
});
