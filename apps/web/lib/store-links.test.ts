import { describe, expect, it } from 'vitest';
import {
  APP_STORE_ID,
  EEA_STOREFRONTS,
  GET_APPLE_PATH,
  PLAY_URL,
  appStoreUrl,
  resolveStoreTarget,
} from './store-links';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; moto g17) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

describe('store constants', () => {
  it('names the two listings by their permanent ids', () => {
    expect(APP_STORE_ID).toBe('6814581951');
    expect(PLAY_URL).toBe('https://play.google.com/store/apps/details?id=world.athanor.app');
    expect(GET_APPLE_PATH).toBe('/get?store=apple');
  });

  it('lists the 29 EEA storefronts the listing exists on, and nothing else', () => {
    // Literal on purpose: a list derived from the module would pass with an entry missing.
    expect([...EEA_STOREFRONTS].sort()).toEqual(
      // prettier-ignore
      ['at','be','bg','cy','cz','de','dk','ee','es','fi','fr','gr','hr','hu','ie','is','it','lt','lu','lv','mt','nl','no','pl','pt','ro','se','si','sk'],
    );
    for (const out of ['us', 'gb', 'ch', 'li']) expect(EEA_STOREFRONTS).not.toContain(out);
  });
});

describe('appStoreUrl', () => {
  it('always carries a storefront — the bare form resolves to the US store and 404s', () => {
    expect(appStoreUrl('de')).toBe('https://apps.apple.com/de/app/athanor/id6814581951');
  });
});

describe('resolveStoreTarget', () => {
  it('sends an iPhone to the storefront of the country it connects from', () => {
    expect(resolveStoreTarget({ userAgent: IPHONE, country: 'DE' })).toEqual({
      kind: 'redirect',
      url: appStoreUrl('de'),
    });
    expect(resolveStoreTarget({ userAgent: IPHONE, country: 'it' })).toEqual({
      kind: 'redirect',
      url: appStoreUrl('it'),
    });
  });

  it('sends Android to Google Play whatever the country', () => {
    for (const country of ['IT', 'US', null]) {
      expect(resolveStoreTarget({ userAgent: ANDROID, country })).toEqual({
        kind: 'redirect',
        url: PLAY_URL,
      });
    }
  });

  it('lets an iPhone outside the EEA choose instead of landing on a store that refuses it', () => {
    for (const country of ['US', 'GB', 'CH', 'LI', 'XX', 'T1', '', null]) {
      expect(resolveStoreTarget({ userAgent: IPHONE, country })).toEqual({
        kind: 'choose',
        platform: 'apple',
      });
    }
  });

  it('shows a desktop both stores', () => {
    expect(resolveStoreTarget({ userAgent: MAC, country: 'DE' })).toEqual({
      kind: 'choose',
      platform: 'unknown',
    });
    expect(resolveStoreTarget({ userAgent: null, country: null })).toEqual({
      kind: 'choose',
      platform: 'unknown',
    });
  });

  it('store=apple is the App Store badge: Apple branch on any device', () => {
    expect(resolveStoreTarget({ userAgent: MAC, country: 'FR', store: 'apple' })).toEqual({
      kind: 'redirect',
      url: appStoreUrl('fr'),
    });
    expect(resolveStoreTarget({ userAgent: ANDROID, country: 'FR', store: 'apple' })).toEqual({
      kind: 'redirect',
      url: appStoreUrl('fr'),
    });
    expect(resolveStoreTarget({ userAgent: MAC, country: 'US', store: 'apple' })).toEqual({
      kind: 'choose',
      platform: 'apple',
    });
  });

  it('ignores a store value it does not know', () => {
    expect(resolveStoreTarget({ userAgent: MAC, country: 'DE', store: 'evil' })).toEqual({
      kind: 'choose',
      platform: 'unknown',
    });
  });
});
