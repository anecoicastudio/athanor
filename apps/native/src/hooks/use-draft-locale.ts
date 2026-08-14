import { useEffect, useState } from 'react';
import type { Locale } from '@athanor/schemas';
import { deviceLocale } from '@/lib/locale';
import { loadDraft } from '@/lib/onboarding-draft';

/**
 * Locale for the pre-auth screens that come AFTER the funnel (welcome,
 * auth-callback): the draft's locale when a draft exists — the member may have
 * switched language on step 0 (#158) — falling back to the device. A bare
 * `deviceLocale` on these screens would revert the choice the moment the funnel
 * hands over. First frame may render device-locale copy; the draft read is a
 * single AsyncStorage get.
 */
export function useDraftLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(deviceLocale);
  useEffect(() => {
    let cancelled = false;
    loadDraft().then((d) => {
      if (!cancelled && d) setLocale(d.locale);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return locale;
}
