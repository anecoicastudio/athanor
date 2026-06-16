import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getMyTicket } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function TicketViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // id = eventId
  const router = useRouter();
  const { profile } = useAuth();
  const locale = (profile?.locale ?? 'it') as 'it' | 'en';
  const uid = profile?.id ?? null;

  const ticketQ = useQuery({
    queryKey: eventKeys.ticket(id),
    queryFn: () => getMyTicket(supabase, id, uid as string),
    enabled: !!id && !!uid,
  });
  const ticket = ticketQ.data ?? null;
  const checkedIn = ticket?.status === 'checked_in';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 pb-12">
      <View className="flex-row items-center gap-3 px-5 pb-1 pt-14">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel={t('common.back', locale)}
        >
          <Text className="text-[22px] text-foreground">‹</Text>
        </Pressable>
        <Text className="text-2xl text-foreground">{t('ticket.viewer.title', locale)}</Text>
      </View>

      {ticketQ.isLoading ? (
        <View className="items-center pt-16">
          <ActivityIndicator color={semantic.aura} />
        </View>
      ) : !ticket || !ticket.qr_token ? (
        <View className="px-5 pt-16">
          <EmptyState>{t('ticket.error.confirm', locale)}</EmptyState>
        </View>
      ) : (
        <View className="items-center gap-5 px-5">
          {/* Conventional polarity: DARK modules on a LIGHT quiet-zone — many door scanners can't
              read an inverted (light-on-dark) QR. Uses the light/dark tokens (no literal hex): the
              chip + QR background are the light `foreground` token, modules the dark `background`. */}
          <View
            className="rounded-hero border border-aura-line p-6"
            style={{ backgroundColor: semantic.foreground }}
          >
            <QRCode
              value={ticket.qr_token}
              size={224}
              color={semantic.background}
              backgroundColor={semantic.foreground}
            />
          </View>
          <Text className="text-center text-[15px] text-ink-2">{t('ticket.show', locale)}</Text>
          <View className="rounded-full border border-hair bg-raise px-4 py-1.5">
            <Text className="text-[13px] text-aura">
              {checkedIn ? t('ticket.status.used', locale) : t('ticket.status.valid', locale)}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
