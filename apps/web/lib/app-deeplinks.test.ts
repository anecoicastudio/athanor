import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_RETURN_TARGETS, APP_SCHEME } from './app-deeplinks';

/**
 * These constants are the whole allowlist for the `/app/*` hand-off pages (#418): the pages
 * forward to a literal from this table and never to anything derived from the request, so
 * what is asserted here is the property that keeps them from being an open redirect.
 *
 * The scheme is read out of `apps/native/app.json` rather than repeated, because a rename
 * there would otherwise leave every one of these pages forwarding into nothing, silently —
 * the browser simply does not navigate, and no log anywhere records it. Same reasoning as
 * `lib/site.test.ts`, which pins the host across the same two packages.
 */
const scheme = (
  JSON.parse(readFileSync(new URL('../../native/app.json', import.meta.url), 'utf8')).expo as {
    scheme: string;
  }
).scheme;

describe('APP_SCHEME', () => {
  it('is the scheme apps/native/app.json declares', () => {
    expect(APP_SCHEME).toBe(`${scheme}://`);
  });
});

describe('APP_RETURN_TARGETS', () => {
  const targets = Object.entries(APP_RETURN_TARGETS);

  it('has at least one target', () => {
    // Guards the loops below against passing vacuously if the table is ever emptied.
    expect(targets.length).toBeGreaterThan(0);
  });

  it('forwards only to the app scheme', () => {
    const strays = targets.filter(([, target]) => !target.startsWith(APP_SCHEME));
    expect(strays).toEqual([]);
  });

  it('carries no query string', () => {
    // Stripe appends its own params to the https URL it redirects to; none of them mean
    // anything to the app (payout and verification state both arrive by webhook), so the
    // hop deliberately drops them rather than reflecting them into the scheme URL.
    const withQuery = targets.filter(([, target]) => target.includes('?'));
    expect(withQuery).toEqual([]);
  });

  it('gives the payout targets more than one path segment', () => {
    // A single-segment stray that escapes the auth session falls into the app's
    // `[handle].tsx`, which rejects it as a malformed profile; a multi-segment one reaches
    // the branded `+not-found`. See the module doc.
    const flat = (['payoutReturn', 'payoutRefresh'] as const).filter(
      (name) => !APP_RETURN_TARGETS[name].slice(APP_SCHEME.length).includes('/'),
    );
    expect(flat).toEqual([]);
  });

  it('points verify at the redirect argument the verify sheet already passes', () => {
    // apps/native/src/app/(modal)/verify.tsx passes 'athanor://verify' to
    // WebBrowser.openAuthSessionAsync — the hop has to match it or the sheet never closes.
    expect(APP_RETURN_TARGETS.verify).toBe(`${APP_SCHEME}verify`);
  });
});
