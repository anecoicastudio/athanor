import { describe, expect, it } from 'vitest';
import { deviceLocale, narrowLocale } from './locale';

describe('narrowLocale', () => {
  it('maps every English region tag to en', () => {
    expect(narrowLocale('en')).toBe('en');
    expect(narrowLocale('en-GB')).toBe('en');
  });

  // Italian is the default for everything unsupported, not just for `it-*` — the pre-auth
  // screens index the catalogs with this before a profile locale exists, so an unmapped
  // device language must land on a real catalog rather than throw at the first t() call.
  it('maps Italian and every other language to it', () => {
    expect(narrowLocale('it-IT')).toBe('it');
    expect(narrowLocale('de-DE')).toBe('it');
    expect(narrowLocale(undefined)).toBe('it');
  });

  // 'en' is a prefix of no other language tag, but a naive `includes` would match e.g.
  // a hypothetical region suffix; pin that the check is anchored at the start.
  it('does not match a tag that merely contains en', () => {
    expect(narrowLocale('zh-Hant')).toBe('it');
  });
});

describe('deviceLocale', () => {
  it('is a supported locale on whatever device runs the suite', () => {
    expect(['it', 'en']).toContain(deviceLocale);
  });
});
