import { describe, expect, it } from 'vitest';
import { readCookieLocale, readLangParam } from './locale-provider';

/**
 * The cookie read is the whole EN path now that the server always renders IT —
 * if it returns null the switch never happens and EN silently disappears.
 */
describe('readCookieLocale', () => {
  it('reads the locale when the cookie is the only one', () => {
    expect(readCookieLocale('athanor_locale=en')).toBe('en');
  });

  it('reads the locale from the middle of a cookie string', () => {
    expect(readCookieLocale('a=1; athanor_locale=en; b=2')).toBe('en');
  });

  it('reads it canonically', () => {
    expect(readCookieLocale('athanor_locale=it')).toBe('it');
  });

  it('returns null when absent', () => {
    expect(readCookieLocale('other=1')).toBeNull();
  });

  it('returns null for an unsupported locale rather than trusting it', () => {
    expect(readCookieLocale('athanor_locale=fr')).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the key', () => {
    expect(readCookieLocale('my_athanor_locale=en')).toBeNull();
  });
});

/**
 * The URL hint (#749). The app opens /privacy and /terms with `?lang=` because a prerendered page
 * has no other way to learn the member's language: the server always renders IT, and the cookie
 * lives in the browser, not in the app. Without the hint an EN member read the Italian policy.
 */
describe('readLangParam', () => {
  it('reads an EN hint', () => {
    expect(readLangParam('?lang=en')).toBe('en');
  });

  it('reads it among other params', () => {
    expect(readLangParam('?utm_source=app&lang=en&x=1')).toBe('en');
  });

  it('reads IT canonically', () => {
    expect(readLangParam('?lang=it')).toBe('it');
  });

  it('returns null with no search string, or no hint in it', () => {
    expect(readLangParam('')).toBeNull();
    expect(readLangParam('?utm_source=app')).toBeNull();
  });

  it('returns null for an unsupported locale rather than trusting it', () => {
    expect(readLangParam('?lang=fr')).toBeNull();
    expect(readLangParam('?lang=EN')).toBeNull();
  });

  it('does not match a param whose name merely ends with the key', () => {
    expect(readLangParam('?flang=en')).toBeNull();
  });
});
