import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// Build-time names app.config.ts reads for the Firebase config (#746). A shell that exports
// either would move `android.googleServicesFile` under every assertion below, so the suite
// starts from neither and restores both.
const ORIGINAL_GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON;
const ORIGINAL_EAS_PLATFORM = process.env.EAS_BUILD_PLATFORM;
delete process.env.GOOGLE_SERVICES_JSON;
delete process.env.EAS_BUILD_PLATFORM;

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
  if (ORIGINAL_GOOGLE_SERVICES === undefined) delete process.env.GOOGLE_SERVICES_JSON;
  else process.env.GOOGLE_SERVICES_JSON = ORIGINAL_GOOGLE_SERVICES;
  if (ORIGINAL_EAS_PLATFORM === undefined) delete process.env.EAS_BUILD_PLATFORM;
  else process.env.EAS_BUILD_PLATFORM = ORIGINAL_EAS_PLATFORM;
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
    const urls = [
      links.legalUrl('terms', 'it'),
      links.legalUrl('privacy', 'en'),
      links.INVITE_URL_BASE,
    ];

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

  it('rejects a configured origin that is not a bare https origin', () => {
    // links.ts concatenates the raw variable, so anything past scheme://host[:port] splits
    // the two sides apart again: `https://host/` hands out `https://host//terms` while the
    // claimed domain is still `host`.
    for (const bad of [
      'not-a-url',
      'http://www.athanor.world',
      'https://www.athanor.world/',
      'https://www.athanor.world/base',
      'https://www.athanor.world?a=1',
      'https://x:y@www.athanor.world',
    ]) {
      process.env.EXPO_PUBLIC_SITE_ORIGIN = bad;
      expect(() => resolveAppConfig({ config: staticConfig() }), bad).toThrow(
        /EXPO_PUBLIC_SITE_ORIGIN/,
      );
    }
  });
});

describe('EXPO_PUBLIC_APP_VARIANT (#755)', () => {
  /*
   * The development variant is a second app on the same phone as the Play install, so it
   * must differ in identity and in nothing else. The unset case is the production build, and
   * it is asserted as the WHOLE resolved config equal to app.json: with the origin unset too,
   * the host rewrite is an identity, so any key this layer ever adds, drops or moves shows up
   * here — not only the keys a list happened to name.
   */
  const ORIGINAL_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT;

  const resolveVariant = (variant: string | undefined) => {
    delete process.env.EXPO_PUBLIC_SITE_ORIGIN;
    if (variant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
    else process.env.EXPO_PUBLIC_APP_VARIANT = variant;
    return resolveAppConfig({ config: staticConfig() });
  };

  afterAll(() => {
    if (ORIGINAL_VARIANT === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
    else process.env.EXPO_PUBLIC_APP_VARIANT = ORIGINAL_VARIANT;
  });

  it.each([undefined, ''])('%j resolves to app.json exactly — production is untouched', (v) => {
    expect(resolveVariant(v)).toEqual(STATIC);
  });

  it('development takes its own package id, bundle id, name and scheme', () => {
    const config = resolveVariant('development');

    expect(config.android?.package).toBe(`${STATIC.android?.package}.dev`);
    expect(config.ios?.bundleIdentifier).toBe(`${STATIC.ios?.bundleIdentifier}.dev`);
    expect(config.name).toBe(`${STATIC.name} Dev`);
    // Its own scheme, or both installed apps claim `athanor://` and an auth return opens
    // whichever the OS picks.
    expect(config.scheme).toBe(`${STATIC.scheme}-dev`);
    expect(config.scheme).not.toBe(STATIC.scheme);
  });

  it('development claims no universal-link domain', () => {
    // assetlinks.json and the AASA list only the production id, so the claim could never
    // verify — it would only put a chooser in front of the Play install's links.
    const config = resolveVariant('development');
    expect(config.android?.intentFilters).toBeUndefined();
    expect(config.ios?.associatedDomains).toBeUndefined();
  });

  it('development changes nothing but identity and link claims', () => {
    const { name: _n, scheme: _s, ios, android, ...rest } = resolveVariant('development');
    const { name: _sn, scheme: _ss, ios: sIos, android: sAndroid, ...sRest } = STATIC;

    expect(rest).toEqual(sRest);
    const { bundleIdentifier: _b, associatedDomains: _a, ...iosRest } = ios ?? {};
    const { bundleIdentifier: _sb, associatedDomains: _sa, ...sIosRest } = sIos ?? {};
    expect(iosRest).toEqual(sIosRest);
    const { package: _p, intentFilters: _i, ...androidRest } = android ?? {};
    const { package: _sp, intentFilters: _si, ...sAndroidRest } = sAndroid ?? {};
    expect(androidRest).toEqual(sAndroidRest);
  });

  it('rejects any other value rather than guessing which app it meant', () => {
    for (const bad of ['production', 'dev', 'Development', ' development']) {
      expect(() => resolveVariant(bad), bad).toThrow(/EXPO_PUBLIC_APP_VARIANT/);
    }
  });

  it('the development profile in eas.json sets the variant', () => {
    // EAS builds never read .env, so the profile is the only place a dev build can learn
    // it is the dev variant — without it the dev client installs over the Play build.
    const easPath = join(dirname(fileURLToPath(import.meta.url)), '../../eas.json');
    const eas = JSON.parse(readFileSync(easPath, 'utf8'));
    expect(eas.build.development.env?.EXPO_PUBLIC_APP_VARIANT).toBe('development');
    for (const profile of ['preview', 'production']) {
      expect(eas.build[profile].env?.EXPO_PUBLIC_APP_VARIANT, profile).toBeUndefined();
    }
  });
});

describe('android.googleServicesFile (#746)', () => {
  /*
   * Without google-services.json in the binary, Firebase never initialises, the push token call
   * throws on every boot, and production collects zero Android tokens with nothing in any log.
   * The file stays out of this public repo, so the path is resolved per build: the
   * GOOGLE_SERVICES_JSON file variable (EAS materialises it; a local `eas build --local` gets it
   * from the shell), else the file beside app.config.ts, else nothing — CI's prebuild has
   * neither and must still pass. An Android EAS build with neither is the one case that
   * throws, because it is the case that would ship that binary.
   */
  const FILE_VAR = '/eas/materialised/google-services.json';
  const withFile = mkdtempSync(join(tmpdir(), 'athanor-gs-'));
  writeFileSync(join(withFile, 'google-services.json'), '{}');
  const withoutFile = mkdtempSync(join(tmpdir(), 'athanor-no-gs-'));

  const resolveWith = (opts: {
    fileVar?: string;
    easPlatform?: string;
    projectRoot?: string;
    variant?: string;
  }) => {
    // Longhand, never `process.env[name]`: source-audit §1 rejects a computed env read anywhere
    // under src/, tests included.
    delete process.env.EXPO_PUBLIC_SITE_ORIGIN;
    if (opts.fileVar === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = opts.fileVar;
    if (opts.easPlatform === undefined) delete process.env.EAS_BUILD_PLATFORM;
    else process.env.EAS_BUILD_PLATFORM = opts.easPlatform;
    if (opts.variant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
    else process.env.EXPO_PUBLIC_APP_VARIANT = opts.variant;
    return resolveAppConfig({ config: staticConfig(), projectRoot: opts.projectRoot });
  };

  afterAll(() => {
    rmSync(withFile, { recursive: true, force: true });
    rmSync(withoutFile, { recursive: true, force: true });
    delete process.env.GOOGLE_SERVICES_JSON;
    delete process.env.EAS_BUILD_PLATFORM;
    delete process.env.EXPO_PUBLIC_APP_VARIANT;
  });

  it('app.json never names the file — the path is a per-build decision', () => {
    expect(STATIC.android?.googleServicesFile).toBeUndefined();
  });

  it('the file variable wins over a file on disk', () => {
    const config = resolveWith({
      fileVar: FILE_VAR,
      projectRoot: withFile,
      easPlatform: 'android',
    });
    expect(config.android?.googleServicesFile).toBe(FILE_VAR);
  });

  it('falls back to the file beside app.config.ts, relative to the project root', () => {
    const config = resolveWith({ projectRoot: withFile });
    expect(config.android?.googleServicesFile).toBe('./google-services.json');
  });

  it.each([
    { where: 'CI prebuild / dev machine', easPlatform: undefined },
    { where: 'an iOS EAS build', easPlatform: 'ios' },
  ])('is omitted when neither exists — $where', ({ easPlatform }) => {
    for (const projectRoot of [withoutFile, undefined]) {
      const config = resolveWith({ projectRoot, easPlatform });
      expect(config.android?.googleServicesFile, String(projectRoot)).toBeUndefined();
      expect(config.android).toEqual(STATIC.android);
    }
  });

  it('an Android EAS build with neither throws, naming the variable', () => {
    for (const projectRoot of [withoutFile, undefined]) {
      expect(() => resolveWith({ projectRoot, easPlatform: 'android' })).toThrow(
        /GOOGLE_SERVICES_JSON/,
      );
    }
  });

  it('the development variant keeps it — both package ids are registered in Firebase', () => {
    const config = resolveWith({ fileVar: FILE_VAR, variant: 'development' });
    expect(config.android?.package).toBe(`${STATIC.android?.package}.dev`);
    expect(config.android?.googleServicesFile).toBe(FILE_VAR);
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

describe('every claimed universal-link prefix has a native screen (#544)', () => {
  /*
   * The intent filters (and the AASA route keyed to the same prefixes) promise the OS that
   * these paths open IN THE APP, so a prefix claimed with no route file sends an installed
   * app to +not-found where the browser would at least have rendered something. The map is
   * exhaustive on purpose, config-invariants style: adding a prefix to app.json means naming
   * its screen here in the same change, and both drifts fail — a prefix missing from the
   * map, and a mapped file that no longer exists. Route groups are URL-invisible to
   * expo-router, which is why `(modal)/…` files serve group-less paths.
   */
  const PREFIX_ROUTE: Record<string, string> = {
    '/momento': 'momento/[id].tsx',
    '/event': '(modal)/event/[id]/index.tsx',
    '/post': '(modal)/post/[id].tsx',
    '/dream': '(modal)/dream/[id].tsx',
    '/invite': 'invite/[code].tsx',
    '/@': '[handle].tsx',
  };

  it('the intent-filter prefix list and the map agree', () => {
    expect([...androidPathPrefixes(STATIC)].sort()).toEqual(Object.keys(PREFIX_ROUTE).sort());
  });

  it('each mapped route file exists', () => {
    const appDir = join(dirname(fileURLToPath(import.meta.url)), '../app');
    for (const [prefix, route] of Object.entries(PREFIX_ROUTE)) {
      expect(existsSync(join(appDir, route)), `${prefix} → src/app/${route}`).toBe(true);
    }
  });
});

describe('supportMailto', () => {
  it('addresses the support inbox and carries the subject, encoded', async () => {
    const { supportMailto, SUPPORT_EMAIL } = await import('./links');
    const url = supportMailto('Athanor — assistenza & altro?');

    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    // A raw `&` or `?` would end the subject early, and a raw space or em dash is not a legal
    // URI character — the mail client would get a truncated or mangled line.
    expect(url).not.toMatch(/subject=.*[ &?—]/);
    expect(decodeURIComponent(url.split('subject=')[1] as string)).toBe(
      'Athanor — assistenza & altro?',
    );
  });
});

describe('legalUrl', () => {
  // The web reads `?lang=` (apps/web/components/locale-provider.tsx `readLangParam`); a bare URL
  // is how an English member was shown the Italian policy (#749).
  it.each(['it', 'en'] as const)('hands the web page the member language (%s)', async (locale) => {
    const { legalUrl, SITE_ORIGIN } = await import('./links');
    for (const doc of ['terms', 'privacy'] as const) {
      const url = new URL(legalUrl(doc, locale));
      expect(`${url.origin}${url.pathname}`).toBe(`${SITE_ORIGIN}/${doc}`);
      expect(url.searchParams.get('lang')).toBe(locale);
    }
  });
});
