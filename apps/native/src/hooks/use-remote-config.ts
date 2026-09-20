import { useQuery } from '@tanstack/react-query';
import { getRemoteConfig, remoteConfigKeys, type RemoteConfigSnapshot } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { saveConfigSnapshot } from '@/lib/config-snapshot';

/**
 * Boot/resume read of the remote kill-switch config (force-update / maintenance / flags).
 * LAST-KNOWN-GOOD contract (RELEASE-RUNBOOK §6): every successful fetch persists a snapshot;
 * on fetch failure BootGate enforces that snapshot, failing open only on first install.
 * staleTime keeps it cheap; BootGate refetches on resume (frontend 12 §2.2).
 */
export function useRemoteConfig() {
  return useQuery<RemoteConfigSnapshot>({
    queryKey: remoteConfigKeys.boot(),
    queryFn: async () => {
      const snap = await getRemoteConfig(supabase);
      saveConfigSnapshot(snap);
      return snap;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/** The feature-flags slice (read-only on client) — gates contributions / Prime Stelle / Fase 2 tiles (M10 R-2). */
export function useFeatureFlags(): Record<string, boolean> {
  return useRemoteConfig().data?.flags ?? {};
}

/** The remote_config key that opens the Circle purchase CTA (#747). Seeded on staging only. */
export const CIRCLE_CHECKOUT_FLAG = 'circle_checkout_enabled';

/**
 * Whether the Circle purchase CTA may render (#747): `'open'` only when a fetch made in THIS
 * session read `{"enabled": true}`. It fails CLOSED, unlike the boot read above, because what
 * it guards is money: production's Stripe is test-mode until the cutover, and a checkout
 * offered there is an offer that cannot complete.
 *
 * - its own key, `meta: { persist: false }` — the boot read is dehydrated to AsyncStorage for
 *   24h, so reusing it would hydrate yesterday's `true` on a device that is now offline or
 *   whose flag was turned off. A cold start always asks the table.
 * - an absent row, a malformed row (skipped by `getRemoteConfig`) or a failed fetch → `'closed'`.
 *   A failed REFETCH closes it too: TanStack keeps the old `data` but moves `status` to `'error'`.
 * - `'loading'` while the first read is in flight, so the screen can show a spinner instead of
 *   flashing the closed line and then swapping it for the CTA.
 */
export function useCircleCheckoutGate(): 'loading' | 'open' | 'closed' {
  const q = useQuery<RemoteConfigSnapshot>({
    queryKey: remoteConfigKeys.live(),
    queryFn: () => getRemoteConfig(supabase),
    staleTime: 60_000,
    retry: 1,
    meta: { persist: false },
  });
  if (q.status === 'pending') return 'loading';
  return q.status === 'success' && q.data.flags[CIRCLE_CHECKOUT_FLAG] === true ? 'open' : 'closed';
}

/**
 * The remote_config key that opens paid events (#806) — the composer's Paid option and the ticket
 * Buy button alike. Seeded on staging; ABSENT on production until the ticket rail is proven live.
 *
 * MIRRORED in `supabase/functions/_shared/remote-config-gate.ts`, which cannot import this file:
 * `apps/native/src/lib/paid-events-gate.test.ts` reads both as text so the two cannot drift.
 */
export const PAID_EVENTS_FLAG = 'paid_events_enabled';

/**
 * Whether paid events may be offered (#806): `'open'` only when a fetch made in THIS session read
 * `{"enabled": true}`. Fails CLOSED for the same reason `useCircleCheckoutGate` above does — it
 * guards money. Production has no Connect account, no webhook signing secret and a test-mode
 * Stripe until the swap (#699), so a ticket offered there is an offer that cannot complete, and
 * an organiser sent to payout onboarding is sent to a dead end.
 *
 * Deliberately a SECOND copy of the gate above rather than a shared `useFlagGate(flag)` helper.
 * The body is what `circle-checkout-gate.test.ts` pins literally — each of those three lines is
 * one way the gate could fail open — and a delegating one-liner would satisfy no assertion at
 * all. Two pinned bodies beat one abstraction nothing can check. It reuses Circle's QUERY KEY on
 * purpose: `getRemoteConfig` selects the whole table, so both gates read one cached snapshot and
 * this fires no second request. A key of its own would double the boot traffic to say the same
 * thing twice.
 */
export function usePaidEventsGate(): 'loading' | 'open' | 'closed' {
  const q = useQuery<RemoteConfigSnapshot>({
    queryKey: remoteConfigKeys.live(),
    queryFn: () => getRemoteConfig(supabase),
    staleTime: 60_000,
    retry: 1,
    meta: { persist: false },
    // `networkMode: 'always'`, the one place this departs from `useCircleCheckoutGate` — and it
    // is about RESOLVING, not about failing open. Under the default `'online'` mode an offline
    // client PAUSES the fetch: `status` stays `'pending'`, this returns `'loading'` forever, and
    // a `'loading'` that never ends is not a third state, it is a hang. It held TicketBar's Buy
    // button dimmed-and-busy with nothing said, and — worse — the composer's chip row with it,
    // so an offline organiser could not create a FREE event either. `payableQ` in TicketBar
    // carries this same flag for this same reason. Offline now fails fast to `'closed'`, which
    // is the honest answer and still the fail-closed one.
    networkMode: 'always',
  });
  if (q.status === 'pending') return 'loading';
  return q.status === 'success' && q.data.flags[PAID_EVENTS_FLAG] === true ? 'open' : 'closed';
}
