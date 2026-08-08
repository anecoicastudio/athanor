import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_URL } from './site';
import { GET as aasaGET } from '@/app/api/well-known/apple-app-site-association/route';
import { GET as assetlinksGET } from '@/app/api/well-known/assetlinks/route';

/**
 * Deep links only work when four files agree on one host and one app id:
 *   apps/web/lib/site.ts              the canonical origin
 *   apps/web/app/api/well-known/*     what Apple and Google fetch to verify ownership
 *   apps/native/app.json              associatedDomains + android.intentFilters
 * A mismatch is silent — links simply open the browser instead of the app, with nothing in
 * any log — so it is asserted here rather than discovered after a store release.
 */
const appJson = JSON.parse(readFileSync(new URL('../../native/app.json', import.meta.url), 'utf8'))
  .expo as {
  ios: { bundleIdentifier: string; associatedDomains: string[] };
  android: {
    package: string;
    intentFilters: { data: { scheme: string; host: string; pathPrefix: string }[] }[];
  };
};

const json = async (res: Response) => JSON.parse(await res.text());

describe('SITE_URL', () => {
  it('is an absolute https origin with no trailing slash', () => {
    // metadataBase, robots and the sitemap all concatenate onto it.
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
  });

  it('matches the host the native app associates with', () => {
    const host = new URL(SITE_URL).host;
    expect(appJson.ios.associatedDomains).toContain(`applinks:${host}`);
    for (const filter of appJson.android.intentFilters) {
      for (const d of filter.data) {
        expect(d.host).toBe(host);
        expect(d.scheme).toBe('https');
      }
    }
  });
});

describe('apple-app-site-association', () => {
  it('is served as JSON with no redirect', async () => {
    // iOS refuses AASA over a redirect or a non-JSON content type.
    const res = aasaGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('names the same bundle identifier as app.json', async () => {
    const [detail] = (await json(aasaGET())).applinks.details;
    expect(detail.appID.endsWith(`.${appJson.ios.bundleIdentifier}`)).toBe(true);
  });

  it('covers every path prefix the Android intent filters claim', async () => {
    // The two platforms must open the same set of links; a prefix on one side only means a
    // link that deep-links on Android and bounces to Safari on iOS.
    const [detail] = (await json(aasaGET())).applinks.details;
    const androidPrefixes = appJson.android.intentFilters.flatMap((f) =>
      f.data.map((d) => d.pathPrefix),
    );
    for (const prefix of androidPrefixes) {
      expect(detail.paths.some((p: string) => p.startsWith(prefix))).toBe(true);
    }
  });

  it('still carries the <TEAMID> placeholder — universal links are NOT live yet', async () => {
    // Pinned deliberately. When the Apple Team ID lands this test fails, which is the prompt
    // to set the same value in apps/native/eas.json submit.production.ios.appleTeamId.
    const doc = await json(aasaGET());
    expect(doc.applinks.details[0].appID).toContain('<TEAMID>');
  });
});

describe('assetlinks.json', () => {
  it('is served as JSON with no redirect', () => {
    const res = assetlinksGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('names the same package as app.json and delegates all urls', async () => {
    const [entry] = await json(assetlinksGET());
    expect(entry.target.package_name).toBe(appJson.android.package);
    expect(entry.target.namespace).toBe('android_app');
    expect(entry.relation).toContain('delegate_permission/common.handle_all_urls');
  });

  it('still carries the <SHA256> placeholder — app links are NOT live yet', async () => {
    // Same prompt as the AASA placeholder: fill from `eas credentials` at P1.5.
    const [entry] = await json(assetlinksGET());
    expect(entry.target.sha256_cert_fingerprints).toContain('<SHA256>');
  });
});
