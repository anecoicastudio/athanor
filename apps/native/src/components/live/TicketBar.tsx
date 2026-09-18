import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import {
  createTicketCheckout,
  eventKeys,
  getMyTicket,
  getOrganizerPayoutsEnabled,
  payoutKeys,
  subscribeTicket,
  TicketCheckoutError,
} from '@athanor/api';
import { formatPrice } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

type Phase = 'idle' | 'opening' | 'confirming' | 'confirmSlow';

// The server's `{error}` strings are the stable contract (#103) — create-ticket-checkout's
// guard ladder on one side, this map on the other. An unmapped code (a 500, a future guard, a
// relay or network failure) degrades to ticket.error.unavailable, never crashes. That fallback
// used to be ticket.error.payment, «the payment didn't go through» — false on every path that
// reaches it (#747): each one fails before Checkout opens, so no payment was ever attempted, and
// a real decline stays inside Stripe's hosted page where this bar never sees it.
const ERROR_COPY: Record<string, MessageKey> = {
  unauthorized: 'ticket.error.signedOut',
  outdated_client: 'ticket.error.outdatedClient',
  'event not found': 'ticket.error.notFound',
  'event is free': 'ticket.error.eventFree',
  'organizer not verified': 'ticket.error.organizerUnverified',
  // #104 — the organiser has no connected account that can receive the split, or Stripe has
  // revoked it. Unmapped this fell through to 'payment failed', which is false: no payment was
  // attempted, and nothing the buyer does can fix it.
  'organizer cannot receive payouts': 'ticket.error.organizerPayouts',
  // #701 — the checkout belt for an event priced under the floor. Near-unreachable (the CHECK and
  // both write gates refuse such a row at creation), but mapped for the same reason the payout arm
  // above is: unmapped it degraded to the generic fallback, which told the buyer to try again when
  // nothing the BUYER can do fixes it. The copy says whose problem it is.
  'ticket below minimum price': 'ticket.error.belowMinimum',
  'organizer cannot buy': 'ticket.error.organizerSelf',
  'event ended': 'ticket.error.eventEnded',
  'ticket already owned': 'ticket.error.alreadyOwned',
  'sold out': 'ticket.error.soldOut',
  'checkout already open': 'ticket.error.checkoutOpen',
};

export function TicketBar({
  event,
  soldOut,
  locale,
}: {
  event: Event;
  /** capacity reached on the paid path (#105) — seats from event_seats_taken vs event.capacity */
  soldOut: boolean;
  locale: 'it' | 'en';
}) {
  const { profile } = useAuth();
  const uid = profile?.id ?? null;
  const router = useRouter();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ticketQ = useQuery({
    queryKey: eventKeys.ticket(event.id),
    queryFn: () => getMyTicket(supabase, event.id, uid as string),
    enabled: !!uid,
  });
  const ticket = ticketQ.data ?? null;

  // #747 — can the organiser be paid right now? The write-time gate (enforce_paid_event_gate)
  // already refuses a paid event from an organiser without payouts, so this catches the case it
  // cannot: `payouts_enabled` flipping false AFTER the event went live (a close proxy for
  // Stripe's `transfers` capability, not the capability itself — MIGRATIONS-ERRATA,
  // 20260906141227). Without it the bar offers a button that can only end in a refusal. A
  // courtesy, never the authority — the server's `organizer cannot receive payouts` refusal
  // stays, and is still mapped in ERROR_COPY.
  //
  // `persist: false`: a money read must not hydrate yesterday's answer (lib/query-client.ts);
  // a cold start always asks. Only a `false` in `data` withdraws the offer. A FIRST read that
  // errors leaves the button live — a failed courtesy check is no evidence the organiser
  // cannot be paid, and the server will say so precisely if they cannot. A refetch that errors
  // keeps whatever `data` it had, so an offer already withdrawn stays withdrawn.
  const payableQ = useQuery({
    queryKey: payoutKeys.organizer(event.organizer_id),
    queryFn: () => getOrganizerPayoutsEnabled(supabase, event.organizer_id),
    enabled: !!uid,
    staleTime: 60_000,
    meta: { persist: false },
    // The button is inert while this is pending, so a slow answer costs a purchase. No retries
    // (a first-read error already leaves the button live) and `networkMode: 'always'` (offline, the default
    // would PAUSE the read and hold the button dead with nothing said; this way it fails fast,
    // and a tap gets ticket.error.unavailable from the checkout call instead).
    retry: false,
    networkMode: 'always',
  });
  const organizerUnpayable = payableQ.data === false;
  const hasTicket = ticket?.status === 'paid' || ticket?.status === 'checked_in';

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeTicket(supabase, event.id, uid, (next) => {
      qc.setQueryData(eventKeys.ticket(event.id), next);
      if (next.status === 'paid' || next.status === 'checked_in') {
        setPhase('idle');
        if (slowTimer.current) clearTimeout(slowTimer.current);
      }
    });
    return unsub;
  }, [event.id, uid, qc]);

  useEffect(() => () => void (slowTimer.current && clearTimeout(slowTimer.current)), []);

  // Re-read the ticket via the query client (stable identity) — not ticketQ.refetch (new each render).
  const refetchTicket = useCallback(
    () => void qc.invalidateQueries({ queryKey: eventKeys.ticket(event.id) }),
    [qc, event.id],
  );

  const onBuy = useCallback(async () => {
    setErrorMsg(null);
    setPhase('opening');
    try {
      const { url } = await createTicketCheckout(supabase, event.id);
      // The hosted Checkout closes by manual dismiss (custom-scheme returns don't auto-close), so we
      // can't tell "paid" from "cancelled" here — the paid ticket arrives via subscribeTicket/realtime.
      await WebBrowser.openBrowserAsync(url);
      setPhase('confirming');
      refetchTicket();
      if (slowTimer.current) clearTimeout(slowTimer.current);
      slowTimer.current = setTimeout(() => setPhase('confirmSlow'), 30000);
    } catch (e) {
      setPhase('idle');
      const code = e instanceof TicketCheckoutError ? e.code : null;
      if (__DEV__) console.log('[ticket] checkout refused:', code ?? e);
      // A 409 means a local query is stale — re-read so the bar flips to its real state.
      // 'checkout already open' (#258) included: the other invocation may have paid by now,
      // and if it did the refetch flips the bar to the ticket instead of arguing.
      if (code === 'ticket already owned' || code === 'checkout already open') refetchTicket();
      if (code === 'sold out') void qc.invalidateQueries({ queryKey: eventKeys.seats(event.id) });
      setErrorMsg(t((code && ERROR_COPY[code]) || 'ticket.error.unavailable', locale));
    }
  }, [event.id, locale, refetchTicket, qc]);

  // Escape the confirming state (e.g. the user cancelled Checkout, so no ticket will ever arrive).
  const dismissConfirming = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    setPhase('idle');
  }, []);

  const openViewer = useCallback(
    () => router.push(`/(modal)/ticket/${event.id}`),
    [router, event.id],
  );

  if (hasTicket) {
    return (
      <Pressable
        className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-3"
        onPress={openViewer}
        accessibilityRole="button"
        accessibilityLabel={t('ticket.view', locale)}
      >
        <Text className="text-center text-[14px] text-aura">{t('ticket.active', locale)}</Text>
        <Text className="text-center text-[12px] text-aura">{t('ticket.view', locale)}</Text>
      </Pressable>
    );
  }

  if (phase === 'confirming' || phase === 'confirmSlow') {
    return (
      <View className="gap-2 rounded-card border border-hair bg-raise p-4">
        <View className="flex-row items-center justify-center gap-2">
          <ActivityIndicator color={semantic.aura} />
          <Text className="text-[13px] text-ink-2">
            {t(phase === 'confirmSlow' ? 'ticket.confirmSlow' : 'ticket.confirming', locale)}
          </Text>
        </View>
        {phase === 'confirmSlow' ? (
          <View className="gap-2">
            <Pressable
              hitSlop={8}
              onPress={refetchTicket}
              accessibilityRole="button"
              accessibilityLabel={t('ticket.refresh', locale)}
            >
              <Text className="text-center text-[13px] text-aura">
                {t('ticket.refresh', locale)}
              </Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={dismissConfirming}
              accessibilityRole="button"
              accessibilityLabel={t('ticket.cancelled', locale)}
            >
              <Text className="text-center text-[12px] text-faint">
                {t('ticket.cancelled', locale)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  // Sold out (#105): same disabled surface as RsvpBar's «Tutto esaurito». A ticket holder
  // never sees it (the hasTicket branch returns first), and a buyer mid-confirmation keeps
  // their spinner — this replaces only the buy button.
  if (soldOut) {
    return (
      <View className="gap-2 rounded-card border border-hair bg-raise p-4">
        <Button label={t('event.soldOut', locale)} variant="ghost" disabled onPress={() => {}} />
        {errorMsg ? <Text className="text-center text-[12px] text-error">{errorMsg}</Text> : null}
      </View>
    );
  }

  // #747 — the organiser cannot be paid: no buy button, and the reason in the ticket bar's own
  // words. Same disabled surface as sold out; the copy is the server refusal's own sentence, in
  // the quiet ink rather than error red, because nothing the buyer did went wrong.
  if (organizerUnpayable) {
    return (
      <View className="gap-2 rounded-card border border-hair bg-raise p-4">
        <Button label={t('ticket.notOnSale', locale)} variant="ghost" disabled onPress={() => {}} />
        <Text className="text-center text-[12px] text-ink-2">
          {t('ticket.error.organizerPayouts', locale)}
        </Text>
        {/* Kept like the sold-out arm: a refusal from the tap that preceded this state. */}
        {errorMsg ? <Text className="text-center text-[12px] text-error">{errorMsg}</Text> : null}
      </View>
    );
  }

  const priceLabel = formatPrice(event.price_cents, event.currency, locale);
  // A buyer never reaches Checkout while the payability read is still in flight (#747) — and
  // the button SAYS so: dimmed like Button's inert state and marked busy, instead of a fully
  // lit control that ignores the tap. The label keeps the price, so nothing jumps.
  const checking = !!uid && payableQ.isPending;
  return (
    <View className="gap-2">
      <Pressable
        className={`rounded-ctl bg-aura px-5 py-3${checking ? ' opacity-40' : ''}`}
        disabled={phase === 'opening' || !uid || checking}
        onPress={() => void onBuy()}
        accessibilityRole="button"
        accessibilityState={{ disabled: phase === 'opening' || !uid || checking, busy: checking }}
      >
        <Text className="text-center text-[14px] font-semibold text-on-aura">
          {t(phase === 'opening' ? 'ticket.opening' : 'ticket.buy', locale, { price: priceLabel })}
        </Text>
      </Pressable>
      {errorMsg ? <Text className="text-center text-[12px] text-error">{errorMsg}</Text> : null}
    </View>
  );
}
