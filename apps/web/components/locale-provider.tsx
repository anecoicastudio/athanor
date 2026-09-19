'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Locale } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';

const COOKIE = 'athanor_locale';
const ONE_YEAR = 60 * 60 * 24 * 365;

const COOKIE_RE = new RegExp(`(?:^|;\\s*)${COOKIE}=(it|en)\\b`);

/** Reads the locale cookie out of a cookie string (`document.cookie` shape). */
export function readCookieLocale(cookie: string): Locale | null {
  const match = cookie.match(COOKIE_RE);
  return match ? (match[1] as Locale) : null;
}

/**
 * Reads a `?lang=it|en` hint out of a search string (`location.search` shape) (#749).
 *
 * The app links to /privacy and /terms with it: a prerendered page cannot learn the member's
 * language any other way, since the server always renders IT and the cookie belongs to the
 * browser, not to the app. Anything else — absent, `fr`, `EN` — is no hint at all.
 */
export function readLangParam(search: string): Locale | null {
  const lang = new URLSearchParams(search).get('lang');
  return lang === 'it' || lang === 'en' ? lang : null;
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Holds the active landing locale (IT canonical). Every public page is prerendered
 * as IT, so the server no longer reads the cookie — this provider picks it up after
 * hydration and switches in place. A returning EN visitor therefore gets a brief
 * flash of Italian, which lands behind the existing splash animation. That is the
 * accepted cost of prerendering; see lib/default-locale.ts.
 *
 * Switching writes the cookie + updates <html lang> and re-renders the page in
 * place — no reload, no scroll reset, no splash replay. The catalogs
 * (@athanor/i18n) already carry full IT + EN copy.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // A `?lang=` hint outranks the cookie for this visit and is NOT written back: it states the
    // language of the link that was followed, not a choice made on this site. Read from
    // `location` inside this post-hydration effect rather than through `useSearchParams`, which
    // on a prerendered route client-renders everything up to the nearest Suspense boundary —
    // from a provider in the root layout, that is the whole page.
    const initial = readLangParam(window.location.search) ?? readCookieLocale(document.cookie);
    // Deferred for the same reason as cookie-notice.tsx: a synchronous setState
    // in an effect trips react-hooks/set-state-in-effect.
    if (initial && initial !== DEFAULT_LOCALE) {
      queueMicrotask(() => {
        setLocaleState(initial);
        document.documentElement.lang = initial;
      });
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${COOKIE}=${next};path=/;max-age=${ONE_YEAR};samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}
