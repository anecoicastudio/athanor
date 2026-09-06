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
  // The star's id, not a boolean: `MomentFlash` needs an EPISODE to show once and get out of
  // the way, and a boolean carries no identity to tell one grant from the next (#691).
  const [starFlash, setStarFlash] = useState<string | null>(null);
  const { showToast } = useToast();

  useAuraRealtime(userId, {
    onStarEarned: (starId) => {
      // Localize the star id → display name for the toast.
      const name = t(`star.${starId}` as MessageKey, locale);
      showToast(t('star.earned.toast', locale, { star: name }));
      setStarFlash(starId);
      setTimeout(() => setStarFlash(null), 2800);
    },
  });

  return { starFlash };
}
