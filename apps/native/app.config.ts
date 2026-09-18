import type { ConfigContext, ExpoConfig } from 'expo/config';

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
 * resolves to the production origin today and this file changes no shipped bytes.
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

export default ({ config }: StaticConfig): ExpoConfig => {
  const configured = process.env.EXPO_PUBLIC_SITE_ORIGIN;
  const host = configured ? configuredHost(configured) : defaultHost(config);

  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (variant && variant !== DEV_VARIANT) {
    throw new Error(
      `EXPO_PUBLIC_APP_VARIANT must be unset or "${DEV_VARIANT}", got ${JSON.stringify(variant)}`,
    );
  }

  const resolved: ExpoConfig = {
    ...config,
    ios: config.ios && { ...config.ios, associatedDomains: [`applinks:${host}`] },
    android: config.android && {
      ...config.android,
      intentFilters: config.android.intentFilters?.map((filter) =>
        filter.data ? { ...filter, data: rehost(filter.data, host) } : filter,
      ),
    },
  };
  return variant ? asDevVariant(resolved) : resolved;
};
