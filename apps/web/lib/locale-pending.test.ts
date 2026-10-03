import { describe, expect, it, vi } from 'vitest';
import {
  LOCALE_PENDING_ATTR,
  LOCALE_PENDING_SCRIPT,
  LOCALE_PENDING_TIMEOUT_MS,
} from './locale-pending';
import { readCookieLocale, readLangParam } from '@/components/locale-provider';

/**
 * The script is a string that runs in the browser before any module loads, so it cannot import
 * the provider's own readers. These cases run it against a stub page and hold it to the same
 * answers `readLangParam` / `readCookieLocale` give — the two must never disagree, or the gate
 * would hide a page the provider never switches (and only the timeout would bring it back).
 */
function run(search: string, cookie: string) {
  const attrs = new Map<string, string>();
  const html = {
    lang: 'it',
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  };
  const timers: { fn: () => void; ms: number }[] = [];
  new Function('document', 'location', 'setTimeout', LOCALE_PENDING_SCRIPT)(
    { documentElement: html, cookie },
    { search },
    (fn: () => void, ms: number) => timers.push({ fn, ms }),
  );
  return { html, attrs, timers };
}

describe('the locale-pending script', () => {
  it.each([
    ['', ''],
    ['', 'athanor_locale=it'],
    ['?lang=it', 'athanor_locale=en'],
    ['?lang=fr', ''],
    ['', 'other=1; athanor_localeX=en'],
  ])('leaves the page alone for search %j, cookie %j', (search, cookie) => {
    const { html, attrs, timers } = run(search, cookie);
    expect((readLangParam(search) ?? readCookieLocale(cookie)) === 'en').toBe(false);
    expect(attrs.has(LOCALE_PENDING_ATTR)).toBe(false);
    expect(html.lang).toBe('it');
    expect(timers).toEqual([]);
  });

  it.each([
    ['', 'athanor_locale=en'],
    ['', 'a=b; athanor_locale=en; c=d'],
    ['?lang=en', ''],
    ['?lang=en', 'athanor_locale=it'],
  ])('marks the page for search %j, cookie %j', (search, cookie) => {
    const { html, attrs, timers } = run(search, cookie);
    expect(readLangParam(search) ?? readCookieLocale(cookie)).toBe('en');
    expect(attrs.has(LOCALE_PENDING_ATTR)).toBe(true);
    // `lang` is the provider's to set, when the copy switches — never the gate's.
    expect(html.lang).toBe('it');
    expect(timers.map((t) => t.ms)).toEqual([LOCALE_PENDING_TIMEOUT_MS]);
  });

  it('lifts on its own when the timeout fires', () => {
    const { attrs, timers } = run('', 'athanor_locale=en');
    timers[0]?.fn();
    expect(attrs.has(LOCALE_PENDING_ATTR)).toBe(false);
  });

  it('never throws, whatever the page gives it', () => {
    const spy = vi.fn();
    expect(() =>
      new Function('document', 'location', 'setTimeout', LOCALE_PENDING_SCRIPT)({}, undefined, spy),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
