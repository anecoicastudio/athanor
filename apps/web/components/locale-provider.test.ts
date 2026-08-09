import { describe, expect, it } from 'vitest';
import { readCookieLocale } from './locale-provider';

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
