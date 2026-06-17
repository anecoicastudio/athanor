import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys, ledgerKeys, starKeys, subscribeAura } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * Subscribe the current user to their Aura realtime channel. Invalidates the
 * relevant TanStack caches on each push so downstream queries refetch
 * automatically. On a tier-up celebration, navigates to the level overlay.
 *
 * Rule #1: NEVER writes to aura_* tables — this hook only reads and invalidates.
 * Engine is dormant (deploy-deferred §TODO(M6-deploy)) → no live pushes yet, but
 * the wiring is correct-by-construction: safe to call, no-crash if never fired.
 *
 * API rule: subscribeAura already returns the channel-removal cleanup fn; the
 * useEffect cleanup calls it. Effect dep = [profileId] prevents double-subscribe.
 */
export function useAuraRealtime(
  profileId: string,
  opts?: { onStarEarned?: (starId: string) => void },
): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Forward the latest onStarEarned through a ref so the subscription (dep:
  // [profileId]) always calls the current closure — e.g. after a locale switch —
  // without re-subscribing on every render.
  const onStarEarnedRef = useRef(opts?.onStarEarned);
  onStarEarnedRef.current = opts?.onStarEarned;

  useEffect(() => {
    if (!profileId) return;

    const cleanup = subscribeAura(supabase, profileId, {
      // aura_scores change → bust both score + detail caches (hero AuraValue re-tweens).
      onScore: () => {
        void queryClient.invalidateQueries({ queryKey: auraKeys.all });
      },

      // New aura_events row → bust ledger so the breakdown page refreshes.
      onEvent: () => {
        void queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      },

      // stars row change → bust stars cache + optionally surface a star-earned flash.
      onStar: (row) => {
        void queryClient.invalidateQueries({ queryKey: starKeys.all });
        // Only fire the consumer callback when the star was just granted (granted_at present).
        const r = row as Record<string, unknown>;
        const starId = typeof r.star_id === 'string' ? r.star_id : null;
        if (starId && r.granted_at != null) {
          onStarEarnedRef.current?.(starId);
        }
      },

      // Celebration broadcast from the score-engine edge function.
      onCelebration: (payload) => {
        // new_stars array may also trigger the star-earned callback.
        if (payload.new_stars) {
          for (const sid of payload.new_stars) {
            onStarEarnedRef.current?.(sid);
          }
        }
        // Tier-up → navigate to the cinematic level overlay.
        if (payload.tier_up) {
          router.push({ pathname: '/(modal)/level', params: { tier: payload.tier_up } });
        }
      },
    });

    return cleanup;
    // Only profileId drives (re)subscription. onStarEarned is read via
    // onStarEarnedRef (updated every render), so omitting it from deps does NOT
    // stale the callback. queryClient/router are stable singletons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
}
