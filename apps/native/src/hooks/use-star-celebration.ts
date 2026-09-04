import { useState } from 'react';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { useToast } from '@/components/ToastHost';
import { useAuraRealtime } from '@/hooks/use-aura-realtime';

/**
 * Star-earned celebration state for Profilo. Realtime wiring: star grants show
 * a toast (global host, #117) + flash; tier-up navigates to /level. Cache
 * invalidation (auraKeys / ledgerKeys / starKeys) happens inside useAuraRealtime.
 */
export function useStarCelebration(userId: string, locale: Locale) {
  const [starFlash, setStarFlash] = useState(false);
  const { showToast } = useToast();

  useAuraRealtime(userId, {
    onStarEarned: (starId) => {
      // Localize the star id → display name for the toast.
      const name = t(`star.${starId}` as MessageKey, locale);
      showToast(t('star.earned.toast', locale, { star: name }));
      setStarFlash(true);
      setTimeout(() => setStarFlash(false), 2800);
    },
  });

  return { starFlash };
}
