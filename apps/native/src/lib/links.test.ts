import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpoConfig } from 'expo/config';
import { afterAll, describe, expect, it, vi } from 'vitest';
import resolveAppConfig from '../../app.config';

/*
 * Deep links only work when the URL the app hands out and the domain the binary claims name
 * one host. Both now derive from EXPO_PUBLIC_SITE_ORIGIN — links.ts reads it directly,
 * app.config.ts rewrites app.json's six host literals from it.
 *
 * This file used to compare the static `SITE_ORIGIN` literal against the static app.json
 * literal. Once the origin became a variable that comparison would have gone green for the
 * wrong reason: CI runs with the variable unset, both sides fall back to production, and the
 * suite certifies exactly the case that breaks — a build configured for another host handing
 * out links on a host its own intent filters no longer claim. So the assertion is now made
 * *per configured value*: for a given origin, the resolved config's associatedDomains host,
 * every resolved Android intentFilters host, and the resolved SITE_ORIGIN's host must agree.
 *
 * apps/web/lib/site.test.ts pins the static app.json to the web origin, and app.json stays
 * the unset-env default of record here, so the chain site.ts -> app.json -> links.ts is still
 * closed end to end.
 */

// fileURLToPath on the string, not `new URL(...)`: this app's tsconfig resolves URL
// to the DOM type, which readFileSync will not accept.
const appJsonPath = join(dirname(fileURLToPath(import.meta.url)), '../../app.json');
/** A fresh parse per call — the resolver spreads it, and a shared object would alias. */
const staticConfig = () => JSON.parse(readFileSync(appJsonPath, 'utf8')).expo as ExpoConfig;

const hostOf = (associated: string) => associated.replace(/^applinks:/, '');

const androidHosts = (config: ExpoConfig): string[] =>
  (config.android?.intentFilters ?? []).flatMap((filter) => {
    const data = filter.data ?? [];
    return (Array.isArray(data) ? data : [data])
      .map((entry) => entry.host)
      .filter((host): host is string => Boolean(host));
  });

const androidPathPrefixes = (config: ExpoConfig): (string | undefined)[] =>
  (config.android?.intentFilters ?? []).flatMap((filter) => {
    const data = filter.data ?? [];
    return (Array.isArray(data) ? data : [data]).map((entry) => entry.pathPrefix);
  });

const STATIC = staticConfig();
const [STATIC_ASSOCIATED] = STATIC.ios?.associatedDomains ?? [];
const STATIC_HOST = hostOf(STATIC_ASSOCIATED!);

// RFC 2606 reserves `.invalid`, so this fixture cannot be mistaken for a real staging origin —
// naming one is #471's call, not this test's.
const CONFIGURED_ORIGIN = 'https://staging.athanor.invalid';

const ORIGINAL_ORIGIN = process.env.EXPO_PUBLIC_SITE_ORIGIN;

/**
 * links.ts reads the variable at module scope (Metro inlines it at bundle time), so the
 * module has to be re-evaluated per value — hence resetModules + a dynamic import.
 * app.config.ts reads it inside the exported function and needs no such treatment.
 */
async function resolve(origin: string | undefined) {
  if (origin === undefined) delete process.env.EXPO_PUBLIC_SITE_ORIGIN;
  else process.env.EXPO_PUBLIC_SITE_ORIGIN = origin;
  vi.resetModules();
  const links = await import('./links');
  return { links, config: resolveAppConfig({ config: staticConfig() }) };
}

afterAll(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.EXPO_PUBLIC_SITE_ORIGIN;
  else process.env.EXPO_PUBLIC_SITE_ORIGIN = ORIGINAL_ORIGIN;
  vi.resetModules();
});

describe.each([
  {
    label: 'unset (app.json is the default of record)',
    origin: undefined,
    expectedHost: STATIC_HOST,
  },
  {
    label: 'set to another origin',
    origin: CONFIGURED_ORIGIN,
    expectedHost: new URL(CONFIGURED_ORIGIN).host,
  },
])('EXPO_PUBLIC_SITE_ORIGIN $label', ({ origin, expectedHost }) => {
  it('claims exactly the host the app hands links out on', async () => {
    const { links, config } = await resolve(origin);

    expect(config.ios?.associatedDomains).toEqual([`applinks:${expectedHost}`]);

    const hosts = androidHosts(config);
    // Same count as the static config: a rewrite that dropped a filter would otherwise
    // satisfy "every host matches" vacuously.
    expect(hosts).toHaveLength(androidHosts(STATIC).length);
    for (const host of hosts) expect(host).toBe(expectedHost);

    expect(new URL(links.SITE_ORIGIN).host).toBe(expectedHost);
    expect(new URL(links.SITE_ORIGIN).protocol).toBe('https:');
  });

  // The list has to be remembered; anchoring the origin itself does not. Every destination
  // derives from SITE_ORIGIN, so this covers constants added after this test was written.
  it('every derived destination inherits that host over https', async () => {
    const { links } = await resolve(origin);
    const urls = [links.LEGAL_TERMS_URL, links.LEGAL_PRIVACY_URL, links.INVITE_URL_BASE];

    for (const url of urls) {
      expect(url.startsWith(`${links.SITE_ORIGIN}/`)).toBe(true);
      expect(new URL(url).host).toBe(expectedHost);
      expect(new URL(url).protocol).toBe('https:');
    }
  });
});

describe('the dynamic config only moves the host', () => {
  it('leaves identity, plugins and path prefixes as app.json declares them', async () => {
    const { config } = await resolve(CONFIGURED_ORIGIN);

    expect(config.slug).toBe(STATIC.slug);
    expect(config.scheme).toBe(STATIC.scheme);
    expect(config.ios?.bundleIdentifier).toBe(STATIC.ios?.bundleIdentifier);
    expect(config.android?.package).toBe(STATIC.android?.package);
    expect(config.plugins).toEqual(STATIC.plugins);
    // apps/web's AASA is keyed to these prefixes — a rewrite that touched them would
    // deep-link on Android and bounce to Safari on iOS.
    expect(androidPathPrefixes(config)).toEqual(androidPathPrefixes(STATIC));
  });

  it('rejects a configured origin that is not an https URL', async () => {
    for (const bad of ['not-a-url', 'http://www.athanor.workers.dev']) {
      process.env.EXPO_PUBLIC_SITE_ORIGIN = bad;
      expect(() => resolveAppConfig({ config: staticConfig() })).toThrow(/EXPO_PUBLIC_SITE_ORIGIN/);
    }
  });
});

describe('external destinations', () => {
  // Configuration the app opens blind (Linking.openURL / mailto:) — a typo ships a dead
  // legal page or a bouncing support address with no compile-time signal.
  it('support email has a mailbox and a domain', async () => {
    const { links } = await resolve(undefined);
    expect(links.SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
});
