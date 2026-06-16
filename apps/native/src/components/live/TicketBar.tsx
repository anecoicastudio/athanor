import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { createTicketCheckout, eventKeys, getMyTicket, subscribeTicket } from '@athanor/api';
import { formatPrice } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

type Phase = 'idle' | 'opening' | 'confirming' | 'confirmSlow';

export function TicketBar({ event, locale }: { event: Event; locale: 'it' | 'en' }) {
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
    } catch {
      setPhase('idle');
      setErrorMsg(t('ticket.error.payment', locale));
    }
  }, [event.id, locale, refetchTicket]);

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

  const priceLabel = formatPrice(event.price_cents, event.currency, locale);
  return (
    <View className="gap-2">
      <Pressable
        className="rounded-ctl bg-aura px-5 py-3"
        disabled={phase === 'opening' || !uid}
        onPress={() => void onBuy()}
        accessibilityRole="button"
      >
        <Text className="text-center text-[14px] font-semibold text-on-aura">
          {t(phase === 'opening' ? 'ticket.opening' : 'ticket.buy', locale, { price: priceLabel })}
        </Text>
      </Pressable>
      {errorMsg ? <Text className="text-center text-[12px] text-error">{errorMsg}</Text> : null}
    </View>
  );
}
