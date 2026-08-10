import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INVITE_URL_BASE, LEGAL_PRIVACY_URL, LEGAL_TERMS_URL, SUPPORT_EMAIL } from './links';

const URLS = [LEGAL_TERMS_URL, LEGAL_PRIVACY_URL, INVITE_URL_BASE];

describe('external destinations', () => {
  // These are configuration the app opens blind (Linking.openURL / mailto:) — a typo ships
  // a dead legal page or a bouncing support address with no compile-time signal.
  it('legal and invite URLs are https and parseable', () => {
    for (const url of URLS) {
      expect(new URL(url).protocol).toBe('https:');
    }
  });

  it('support email has a mailbox and a domain', () => {
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  /*
   * Added with the Cloudflare origin swap, and anchored to app.json rather than to a
   * literal on purpose. apps/web/lib/site.test.ts already pins app.json to the web
   * origin; this pins these URLs to app.json, so the chain site.ts → app.json →
   * links.ts is closed and one edit to app.json forces both ends.
   *
   * A literal here would not close it: on the next host change, links.ts and the
   * literal would go stale together and agree with each other, so this file would
   * stay green while the app handed out invite and legal URLs on a host its own
   * intent filters no longer claim — which opens the browser instead of the app,
   * silently. That is the exact failure this is meant to catch.
   */
  // fileURLToPath on the string, not `new URL(...)`: this app's tsconfig resolves URL
  // to the DOM type, which readFileSync will not accept.
  const appJsonPath = join(dirname(fileURLToPath(import.meta.url)), '../../app.json');
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8')).expo as {
    ios: { associatedDomains: string[] };
  };

  it('sit on the host the app associates with', () => {
    const [associated] = appJson.ios.associatedDomains;
    expect(associated).toBeDefined();
    const host = associated!.replace(/^applinks:/, '');
    for (const url of URLS) {
      expect(new URL(url).host).toBe(host);
    }
  });
});
