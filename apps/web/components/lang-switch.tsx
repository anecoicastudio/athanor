'use client';

import { t, type Locale } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';

const LOCALES: readonly Locale[] = ['it', 'en'];

/**
 * IT · EN language toggle for the landing header. Switches the copy in place via
 * the locale context (no reload, no scroll reset). The active locale reads in
 * foreground, the other muted; never aura cyan — that is reserved for moments
 * that matter (DESIGN.md §4). The full language name (catalog `lang.*`) rides on
 * aria-label for assistive tech. The buttons carry padding cancelled by a negative margin: a
 * 32×44 hit area around a 16px label, with no change to the layout.
 */
export function LangSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div
      className={`flex items-center gap-2 text-xs font-semibold tracking-[0.14em] ${className ?? ''}`}
    >
      {LOCALES.map((loc, i) => {
        const active = loc === locale;
        return (
          <span key={loc} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-border">
                ·
              </span>
            )}
            <button
              type="button"
              onClick={() => setLocale(loc)}
              aria-pressed={active}
              aria-label={t(loc === 'it' ? 'lang.it' : 'lang.en', locale)}
              className={`-mx-2 -my-3.5 px-2 py-3.5 uppercase transition-opacity hover:opacity-80 ${
                active ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {loc}
            </button>
          </span>
        );
      })}
    </div>
  );
}
