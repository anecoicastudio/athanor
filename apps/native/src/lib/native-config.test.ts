import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { semantic } from '@athanor/config';
import type { ExpoConfig } from 'expo/config';
import { afterAll, describe, expect, it } from 'vitest';
import resolveAppConfig from '../../app.config';

/*
 * The Android permission surface is a Play declaration, not a build detail: every permission in
 * the merged manifest is one the Play Console asks the store listing to justify. Until #776 the
 * manifest asked for two foreground-service permissions (expo-audio's background-playback default)
 * and ACCESS_FINE_LOCATION, none of which the app uses — and FINE made the Data safety form's
 * "approximate location only" false (#781). This file pins the config that removes them, the
 * notification icon (#772), and the source half of #781: every fix the app takes is the lowest
 * accuracy, snapped to the event grid before it goes anywhere.
 *
 * Asserted on BOTH resolved variants, not on app.json alone: app.config.ts rewrites the Android
 * block for the dev client (world.athanor.app.dev), and a resolver that dropped blockedPermissions
 * would ship the dev build a manifest nobody tested.
 *
 * It also pins the eas.json half of #466 — which profiles upload Sentry symbols — because that is
 * native build config in the same sense, and nothing else in the tree asserted it.
 */

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** A fresh parse per call — the resolver spreads it, and a shared object would alias. */
const staticConfig = () =>
  JSON.parse(readFileSync(join(NATIVE, 'app.json'), 'utf8')).expo as ExpoConfig;

const ORIGINAL_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT;
const resolveVariant = (variant: 'development' | undefined): ExpoConfig => {
  if (variant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
  else process.env.EXPO_PUBLIC_APP_VARIANT = variant;
  return resolveAppConfig({ config: staticConfig() });
};
afterAll(() => {
  if (ORIGINAL_VARIANT === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
  else process.env.EXPO_PUBLIC_APP_VARIANT = ORIGINAL_VARIANT;
});

/** A plugin's props: `{}` for a bare string entry, `undefined` when the plugin is absent. */
function pluginProps(config: ExpoConfig, name: string): Record<string, unknown> | undefined {
  for (const entry of config.plugins ?? []) {
    if (entry === name) return {};
    if (Array.isArray(entry) && entry[0] === name)
      return (entry[1] ?? {}) as Record<string, unknown>;
  }
  return undefined;
}

const BLOCKED = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.ACCESS_FINE_LOCATION',
  'com.google.android.gms.permission.AD_ID',
];

describe.each([
  ['production', undefined],
  ['development', 'development'],
] as const)('resolved %s config', (_label, variant) => {
  const config = resolveVariant(variant);

  it('requests ACCESS_COARSE_LOCATION and never ACCESS_FINE_LOCATION (#781)', () => {
    expect(config.android?.permissions).toContain('android.permission.ACCESS_COARSE_LOCATION');
    expect(config.android?.permissions).not.toContain('android.permission.ACCESS_FINE_LOCATION');
  });

  it('blocks FINE, both foreground-service permissions and AD_ID at manifest merge (#776)', () => {
    // A library manifest re-adds what the list above leaves out — expo-location's declares FINE
    // itself — so only `tools:node="remove"`, which is what blockedPermissions writes, removes it.
    expect(config.android?.blockedPermissions).toEqual(expect.arrayContaining(BLOCKED));
  });

  it('turns off expo-audio background playback, which is what declared the service (#776)', () => {
    // Defaults to true: without this the plugin adds FOREGROUND_SERVICE(_MEDIA_PLAYBACK) and
    // AudioControlsService, and blocking the permissions alone would leave the service declared.
    expect(pluginProps(config, 'expo-audio')?.enableBackgroundPlayback).toBe(false);
  });

  it('adds no expo-video background playback either', () => {
    expect(pluginProps(config, 'expo-video')?.supportsBackgroundPlayback).not.toBe(true);
  });

  it('removes expo-location’s LocationTaskService with the local plugin (#776)', () => {
    // The library manifest declares it with foregroundServiceType="location"; nothing in app.json
    // can take it out except a `tools:node="remove"` element, which only a config plugin writes.
    expect(pluginProps(config, LOCATION_PLUGIN)).toEqual({});
  });

  it('gives expo-notifications the mandorla icon, tinted aura (#772)', () => {
    const props = pluginProps(config, 'expo-notifications');
    expect(props?.icon).toBe('./assets/images/notification-icon.png');
    expect(props?.color).toBe(semantic.aura);
  });
});

const LOCATION_PLUGIN = './plugins/without-location-task-service.js';

describe('without-location-task-service plugin (#776)', () => {
  const plugin = createRequire(import.meta.url)(`../../${LOCATION_PLUGIN.slice(2)}`) as {
    removeLocationTaskService: (manifest: unknown) => {
      manifest: {
        $: Record<string, string>;
        application: { $: Record<string, string>; service?: { $: Record<string, string> }[] }[];
      };
    };
    LOCATION_TASK_SERVICE: string;
  };
  const manifest = (services: { $: Record<string, string> }[]) => ({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication' }, service: services }],
    },
  });
  const OTHER = {
    $: { 'android:name': 'expo.modules.notifications.service.ExpoFirebaseMessagingService' },
  };

  it('names the service expo-location declares', () => {
    expect(plugin.LOCATION_TASK_SERVICE).toBe('expo.modules.location.services.LocationTaskService');
  });

  it('marks the service for removal at manifest merge and keeps every other service', () => {
    const out = plugin.removeLocationTaskService(manifest([OTHER]));
    expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(out.manifest.application[0]!.service).toEqual([
      OTHER,
      {
        $: {
          'android:name': 'expo.modules.location.services.LocationTaskService',
          'tools:node': 'remove',
        },
      },
    ]);
  });

  it('is idempotent — a second run, or a manifest that already names it, leaves one entry', () => {
    const once = plugin.removeLocationTaskService(manifest([OTHER]));
    const twice = plugin.removeLocationTaskService(once);
    const named = twice.manifest.application[0]!.service!.filter(
      (s) => s.$['android:name'] === plugin.LOCATION_TASK_SERVICE,
    );
    expect(named).toEqual([
      { $: { 'android:name': plugin.LOCATION_TASK_SERVICE, 'tools:node': 'remove' } },
    ]);
  });

  it('works on an application that declares no services at all', () => {
    const out = plugin.removeLocationTaskService(manifest(undefined as never));
    expect(out.manifest.application[0]!.service).toEqual([
      { $: { 'android:name': plugin.LOCATION_TASK_SERVICE, 'tools:node': 'remove' } },
    ]);
  });
});

describe('notification icon asset (#772)', () => {
  it('is a 96×96 RGBA PNG — the size expo-notifications documents', () => {
    const png = readFileSync(join(NATIVE, 'assets/images/notification-icon.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 96]);
    expect(png[25]).toBe(6); // colour type 6: truecolour with alpha
  });

  it('is rendered from a source that paints white and nothing else', () => {
    const svg = readFileSync(
      join(NATIVE, '../../packages/config/assets/notification-icon.svg'),
      'utf8',
    );
    const colours = [...svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,8}|url\([^)]*\))"/g)].map(
      (m) => m[1]!.toUpperCase(),
    );
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set(['#FFFFFF']));
  });
});

describe('location fixes in the app (#781)', () => {
  const SRC = join(NATIVE, 'src');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const callers = sources(SRC)
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    .filter(({ text }) => text.includes('getCurrentPositionAsync('));

  it('still finds the two callers — event-create and «Vicino»', () => {
    expect(callers.map(({ path }) => path.slice(SRC.length + 1)).sort()).toEqual([
      'app/(modal)/event-create.tsx',
      'components/live/VicinoPanel.tsx',
    ]);
  });

  it.each(['event-create.tsx', 'VicinoPanel.tsx'])(
    '%s asks for Accuracy.Lowest and snaps the fix to the event grid',
    (file) => {
      const { text } = callers.find(({ path }) => path.endsWith(file))!;
      expect(text).toMatch(
        /getCurrentPositionAsync\(\{\s*accuracy:\s*Location\.Accuracy\.Lowest\s*\}\)/,
      );
      expect(text).not.toMatch(/Location\.Accuracy\.(?!Lowest\b)\w+/);
      expect(text).toContain('snapToEventGrid(');
      // The OS geocoder is off-device too: it gets the snapped point, never the raw fix.
      expect(text).not.toMatch(/reverseGeocodeAsync\(\s*pos\.coords\s*\)/);
    },
  );

  it('snaps a geocoded venue before it is used — the venue is the point, on the grid (#781)', () => {
    const { text } = callers.find(({ path }) => path.endsWith('event-create.tsx'))!;
    expect(text).toContain('Location.geocodeAsync(');
    expect(text).toMatch(/snapToEventGrid\(\{ lat: hit\.latitude, lng: hit\.longitude \}\)/);
  });

  it('takes no other kind of fix — no watch, no last-known position', () => {
    for (const { text } of sources(SRC).map((path) => ({ text: readFileSync(path, 'utf8') }))) {
      expect(text).not.toMatch(
        /watchPositionAsync|getLastKnownPositionAsync|startLocationUpdatesAsync/,
      );
    }
  });
});

/*
 * One environment variable decides whether a build ships symbolicatable crashes:
 * `SENTRY_DISABLE_AUTO_UPLOAD` gates the Android gradle task, the iOS source-map phase and the
 * iOS dSYM phase, all three. From 2026-08-19 it sat on `base`, and eas-cli's `mergeProfiles`
 * SHALLOW-MERGES `env` down an `extends` chain, so every profile inherited it — production
 * included, which is the bug #466 names.
 *
 * Asserted on the RESOLVED env, never on one profile's own keys: the inheritance is the whole
 * failure mode, so a pin that reads `base` alone would stay green the moment the key came back
 * one level down.
 */
type EasProfile = { extends?: string; env?: Record<string, string> };

/** eas-cli `mergeProfiles`: walk `extends`, shallow-merge `env`, child keys win. */
function resolveEnv(
  build: Record<string, EasProfile>,
  name: string,
  depth = 0,
): Record<string, string> {
  if (depth >= 5) throw new Error(`eas.json: extends chain too long or cyclic at "${name}"`);
  const profile = build[name];
  if (!profile) throw new Error(`eas.json: no build profile named "${name}"`);
  const inherited = profile.extends ? resolveEnv(build, profile.extends, depth + 1) : {};
  return { ...inherited, ...(profile.env ?? {}) };
}

describe('Sentry symbol upload per EAS profile (#466)', () => {
  const build = JSON.parse(readFileSync(join(NATIVE, 'eas.json'), 'utf8')).build as Record<
    string,
    EasProfile
  >;

  it('production uploads — nothing in its extends chain disables it', () => {
    expect(resolveEnv(build, 'production').SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
  });

  it.each(['development', 'preview'])(
    '%s stays disabled, so an internal build never needs the auth token',
    (profile) => {
      expect(resolveEnv(build, profile).SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    },
  );

  it('no profile carries the credentials — they come from EAS env or the build shell', () => {
    for (const name of Object.keys(build)) {
      const names = Object.keys(resolveEnv(build, name));
      expect(names, name).not.toContain('SENTRY_AUTH_TOKEN');
      expect(names, name).not.toContain('SENTRY_URL');
    }
  });

  it('registers the Expo plugin, which is what writes sentry.properties at prebuild', () => {
    // Without it there is no gradle upload task and no Xcode phase at all, so the profiles above
    // would be asserting a switch on a machine that was never wired up.
    for (const variant of [undefined, 'development'] as const) {
      expect(pluginProps(resolveVariant(variant), '@sentry/react-native/expo')).toEqual({});
    }
  });
});
