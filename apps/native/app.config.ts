import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import en from '../../packages/i18n/src/catalogs/en.json';
import it from '../../packages/i18n/src/catalogs/it.json';

/**
 * Dynamic layer over `app.json` (#486).
 *
 * The URLs the app hands out (`src/lib/links.ts`) and the universal-link domains the binary
 * *claims* have to name one host, or a link opens the browser instead of the app — silently,
 * with nothing in any log. Before this file they were two unrelated literals that happened to
 * agree: `SITE_ORIGIN` in links.ts, and six copies of the host in app.json. A build pointed at
 * another environment could only ever move one of them, so it would hand out links on a host
 * its own intent filters no longer claimed.
 *
 * Both sides now derive from `EXPO_PUBLIC_SITE_ORIGIN`. `app.json` stays static and stays the
 * default of record: with the variable unset this file rewrites the host to the one app.json
 * already declares, which is why `apps/web/lib/site.test.ts` and `apps/web/turbo.json`'s
 * `$TURBO_ROOT$/apps/native/app.json` cache input keep working untouched.
 *
 * Unset is a fallback, never a throw. No staging web host exists, so every EAS profile
 * resolves to the production origin today and the host rewrite changes no shipped bytes.
 * A *malformed* value is a throw, because config time is the last place a wrong host is still
 * visible — past it the binary ships claiming a domain nobody serves.
 *
 * `ConfigContext` types `config` as `Partial<ExpoConfig>`; app.json satisfies the whole shape,
 * and naming it `ExpoConfig` here keeps the spread below from needing a cast. `ConfigContext`
 * is still imported so the contract this file implements is named rather than described.
 */
type StaticConfig = { config: ExpoConfig } & Partial<Omit<ConfigContext, 'config'>>;

type Android = NonNullable<ExpoConfig['android']>;
type IntentFilter = NonNullable<Android['intentFilters']>[number];
type FilterData = NonNullable<IntentFilter['data']>;

const APPLINKS = /^applinks:/;

/** app.json's own claim, used verbatim when EXPO_PUBLIC_SITE_ORIGIN is unset. */
function defaultHost(config: ExpoConfig): string {
  const [associated] = config.ios?.associatedDomains ?? [];
  if (!associated) {
    throw new Error(
      'app.json must declare ios.associatedDomains[0] — it is the default universal-link host.',
    );
  }
  return associated.replace(APPLINKS, '');
}

function configuredHost(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`EXPO_PUBLIC_SITE_ORIGIN is not a URL: ${origin}`);
  }
  // Universal links and App Links are https-only, and the intent filters below keep
  // `"scheme": "https"`; an http origin would claim a host the app could never open.
  if (url.protocol !== 'https:') {
    throw new Error(`EXPO_PUBLIC_SITE_ORIGIN must be an https origin, got ${origin}`);
  }
  // `URL.origin` is scheme://host[:port] and nothing else, so one comparison rejects a
  // trailing slash, a path, a query and embedded credentials. Rejected rather than
  // normalised, because `links.ts` concatenates the raw variable: `https://x/` would claim
  // host `x` here and hand out `https://x//terms` there, which is the same class of
  // silent split this file exists to close.
  if (url.origin !== origin) {
    throw new Error(
      `EXPO_PUBLIC_SITE_ORIGIN must be a bare origin with no path or trailing slash, got ${origin}`,
    );
  }
  return url.host;
}

/** Rewrites only entries that already declare a host, so a hostless filter stays hostless. */
function rehost(data: FilterData, host: string): FilterData {
  const one = (entry: Exclude<FilterData, unknown[]>) => (entry.host ? { ...entry, host } : entry);
  return Array.isArray(data) ? data.map(one) : one(data);
}

/**
 * The development-client variant (#755): a second app that installs next to the Play build
 * on the same phone, so a branch is checked on Android by starting Metro, not by paying for
 * an EAS build. Set by the `development` profile in eas.json and by `pnpm start:dev-client`;
 * unset everywhere else, which is the production app exactly.
 *
 * It changes identity and nothing else: its own package / bundle id and display name, its
 * own URL scheme (or both apps claim `athanor://` and an auth return lands in whichever the
 * OS picks), and no universal-link claim — assetlinks.json and the AASA list only the
 * production id, so a claim could never verify and would only put a chooser in front of the
 * Play install's links. Any other value throws: guessing would build the wrong app.
 */
const DEV_VARIANT = 'development';

function asDevVariant(config: ExpoConfig): ExpoConfig {
  const { associatedDomains: _domains, ...ios } = config.ios ?? {};
  const { intentFilters: _filters, ...android } = config.android ?? {};
  return {
    ...config,
    name: `${config.name} Dev`,
    scheme: `${config.scheme}-dev`,
    ios: config.ios && { ...ios, bundleIdentifier: `${config.ios.bundleIdentifier}.dev` },
    android: config.android && { ...android, package: `${config.android.package}.dev` },
  };
}

/**
 * Firebase's Android client config (#746). Without it in the binary Firebase never initialises,
 * `getExpoPushTokenAsync` throws on every boot, and production collects zero Android push
 * tokens. The file lists both package ids (the production app and the dev variant above), so
 * one path serves both.
 *
 * It stays out of this public repo (.gitignore), which means a build's working tree never has
 * it: EAS copies the tree honouring .gitignore, locally (`eas build --local`) as much as in the
 * cloud. So the path comes from outside, in this order:
 *
 *  1. `GOOGLE_SERVICES_JSON` — the EAS file variable, which EAS materialises and points at; for
 *     a local build the shell supplies it (README §Android dev client);
 *  2. `google-services.json` beside this file — `expo prebuild` / `expo run` from the checkout;
 *  3. nothing. CI's prebuild job has neither, and the plugin throws on a path that is set but
 *     missing, so the key is omitted rather than guessed.
 *
 * Except that (3) on an Android EAS build is a throw: that build would ship a binary that can
 * never receive a push, and say so nowhere — which is #746 exactly. `EAS_BUILD_PLATFORM` is set
 * by EAS inside every build job, cloud and local, and by nothing else.
 */
const GOOGLE_SERVICES_FILE = 'google-services.json';

function googleServicesFile(projectRoot: string | undefined): string | undefined {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  if (fromEnv) return fromEnv;
  if (projectRoot && existsSync(join(projectRoot, GOOGLE_SERVICES_FILE))) {
    return `./${GOOGLE_SERVICES_FILE}`;
  }
  if (process.env.EAS_BUILD_PLATFORM === 'android') {
    throw new Error(
      `No ${GOOGLE_SERVICES_FILE} for this Android build, so push could never register. Set ` +
        'GOOGLE_SERVICES_JSON: the EAS file variable for cloud builds, or ' +
        `GOOGLE_SERVICES_JSON="$PWD/${GOOGLE_SERVICES_FILE}" in front of eas build --local.`,
    );
  }
  return undefined;
}

/**
 * The iOS permission prompts, per language (#83). The plugins in app.json write one English
 * usage description into Info.plist; Expo's `locales` writes `<lang>.lproj/InfoPlist.strings`
 * at prebuild, and iOS shows the one matching the phone's language. Without it an Italian phone
 * asks for the camera in English — the prompt is the OS's, so nothing in the app can translate it.
 *
 * The copy lives in the @athanor/i18n catalogs like every other string, so IT stays canonical
 * and the parity and voice tests cover it. `en` is listed as well as `it`: the development
 * region is English, and a phone in any third language falls back to en.lproj, which then says
 * what app.json says (native-config.test.ts pins the two equal).
 *
 * Only the prompts the app can actually raise are here. The plugins also write generic
 * defaults — Face ID, reminders, always-on location, motion — for APIs nothing in src/ calls.
 *
 * Expo writes each value between double quotes without escaping it (@expo/config-plugins 57,
 * ios/Locales.js), so a `"` or a backslash in the catalog would corrupt the .strings file and
 * fail the build far from the edit that caused it. Refused here instead.
 */
const IOS_PERMISSION_KEYS = {
  NSCameraUsageDescription: 'permission.ios.camera',
  NSPhotoLibraryUsageDescription: 'permission.ios.photos',
  NSMicrophoneUsageDescription: 'permission.ios.microphone',
  NSLocationWhenInUseUsageDescription: 'permission.ios.location',
  NSCalendarsUsageDescription: 'permission.ios.calendar',
  NSCalendarsFullAccessUsageDescription: 'permission.ios.calendar',
} as const satisfies Record<string, keyof typeof it & keyof typeof en>;

function iosPermissionStrings(catalog: typeof it | typeof en): Record<string, string> {
  return Object.fromEntries(
    Object.entries(IOS_PERMISSION_KEYS).map(([plistKey, messageKey]) => {
      const value = catalog[messageKey];
      if (/["\\\n]/.test(value)) {
        throw new Error(`${messageKey} cannot go into InfoPlist.strings as is: ${value}`);
      }
      return [plistKey, value];
    }),
  );
}

export default ({ config, projectRoot }: StaticConfig): ExpoConfig => {
  const configured = process.env.EXPO_PUBLIC_SITE_ORIGIN;
  const host = configured ? configuredHost(configured) : defaultHost(config);

  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (variant && variant !== DEV_VARIANT) {
    throw new Error(
      `EXPO_PUBLIC_APP_VARIANT must be unset or "${DEV_VARIANT}", got ${JSON.stringify(variant)}`,
    );
  }

  const firebase = googleServicesFile(projectRoot);
  const resolved: ExpoConfig = {
    ...config,
    ios: config.ios && { ...config.ios, associatedDomains: [`applinks:${host}`] },
    locales: {
      it: { ios: iosPermissionStrings(it) },
      en: { ios: iosPermissionStrings(en) },
    },
    android: config.android && {
      ...config.android,
      intentFilters: config.android.intentFilters?.map((filter) =>
        filter.data ? { ...filter, data: rehost(filter.data, host) } : filter,
      ),
      // Absent rather than `undefined` when unresolved, so the unset case is app.json exactly.
      ...(firebase && { googleServicesFile: firebase }),
    },
  };
  return variant ? asDevVariant(resolved) : resolved;
};
