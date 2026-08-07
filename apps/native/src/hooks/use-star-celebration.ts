import { useState } from 'react';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { useAuraRealtime } from '@/hooks/use-aura-realtime';

/**
 * Star-earned celebration state for Profilo. Realtime wiring: star grants show
 * a toast + flash; tier-up navigates to /level. Cache invalidation
 * (auraKeys / ledgerKeys / starKeys) happens inside useAuraRealtime.
 */
export function useStarCelebration(userId: string, locale: Locale) {
  const [starToast, setStarToast] = useState<string | null>(null);
  const [starFlash, setStarFlash] = useState(false);

  useAuraRealtime(userId, {
    onStarEarned: (starId) => {
      // Localize the star id → display name for the toast.
      const name = t(`star.${starId}` as MessageKey, locale);
      setStarToast(t('star.earned.toast', locale, { star: name }));
      setStarFlash(true);
      setTimeout(() => {
        setStarToast(null);
        setStarFlash(false);
      }, 2800);
    },
  });

  return { starToast, starFlash };
}
