'use client';

import { type Locale, type MessageKey, t as translate } from '@auria/i18n';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

type Vars = Record<string, string | number>;

type I18n = {
  locale: Locale;
  /** Looks up a key in the active locale, then fills `{name}` placeholders. */
  t: (key: MessageKey, vars?: Vars) => string;
};

const I18nContext = createContext<I18n | null>(null);

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Seed `locale` from the signed-in profile in the authed shell; default 'it' elsewhere. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({ locale, t: (key, vars) => interpolate(translate(key, locale), vars) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
