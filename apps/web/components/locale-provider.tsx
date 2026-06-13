'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Locale } from '@auria/i18n';

const COOKIE = 'auria_locale';
const ONE_YEAR = 60 * 60 * 24 * 365;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Holds the active landing locale (IT canonical). `initialLocale` comes from the
 * `auria_locale` cookie read server-side in layout.tsx, so SSR and the first
 * client render agree (no flash). Switching writes the cookie + updates
 * <html lang> and re-renders the page in place — no reload, no scroll reset, no
 * splash replay. The catalogs (@auria/i18n) already carry full IT + EN copy.
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

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
