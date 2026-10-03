/**
 * Where the two store listings live, and which one a visitor is sent to (#269).
 *
 * The App Store is the reason this is a function and not a constant. A listing URL names a
 * storefront, and Apple serves it only to an Apple ID of that country: tested 2026-10-03, the
 * bare `apps.apple.com/app/athanor/id…` form resolves to the US storefront, where Athanor is
 * not sold, and `/it/` is refused to a German account while `/de/` opens. So a fixed href is
 * wrong for most visitors, and every Apple link on the site goes through `/get`, which picks
 * the storefront from the country the request arrives from. That country is where the
 * connection is, not where the account is — hence `choose`, and the picker `/get` renders.
 *
 * Google Play needs none of this: its URL carries no country.
 */
export const APP_STORE_ID = '6814581951';
export const PLAY_PACKAGE = 'world.athanor.app';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

export const GET_PATH = '/get';
/** What the App Store badge links to: the Apple branch, on whatever device taps it. */
export const GET_APPLE_PATH = `${GET_PATH}?store=apple`;

/**
 * The storefronts the listing exists on: the EU-27 plus Norway and Iceland. Each was confirmed
 * against Apple's lookup API on 2026-10-03. Liechtenstein is in the EEA but has no storefront
 * of its own. Changing App Availability in App Store Connect means changing this list.
 */
// prettier-ignore
export const EEA_STOREFRONTS = [
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it',
  'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'no', 'is',
] as const;
export type Storefront = (typeof EEA_STOREFRONTS)[number];

export function appStoreUrl(storefront: Storefront): string {
  return `https://apps.apple.com/${storefront}/app/athanor/id${APP_STORE_ID}`;
}

function storefrontFor(country: string | null | undefined): Storefront | null {
  const code = country?.toLowerCase();
  return (EEA_STOREFRONTS as readonly string[]).includes(code ?? '') ? (code as Storefront) : null;
}

export type StorePlatform = 'apple' | 'unknown';
export type StoreTarget =
  | { kind: 'redirect'; url: string }
  /** No store can be chosen for them: show both badges and the storefront picker. */
  | { kind: 'choose'; platform: StorePlatform };

export function resolveStoreTarget({
  userAgent,
  country,
  store,
}: {
  userAgent: string | null | undefined;
  /** ISO 3166-1 alpha-2 from `cf-ipcountry`; null when the header is absent. */
  country: string | null | undefined;
  store?: string | null;
}): StoreTarget {
  const ua = userAgent ?? '';
  const apple = store === 'apple' || /iPhone|iPod|iPad/.test(ua);
  if (apple) {
    const storefront = storefrontFor(country);
    return storefront
      ? { kind: 'redirect', url: appStoreUrl(storefront) }
      : { kind: 'choose', platform: 'apple' };
  }
  if (/Android/.test(ua)) return { kind: 'redirect', url: PLAY_URL };
  return { kind: 'choose', platform: 'unknown' };
}
