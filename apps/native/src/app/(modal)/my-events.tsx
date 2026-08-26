import { ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventsByOrganizer } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { ScrollView, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { EVENT_HREF, EventRow } from '@/components/live/EventRow';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

/**
 * I tuoi eventi — organizer surface (P4.5; frontend 04 §3.7 Live entry).
 * Makes (modal)/event-create reachable and lists the caller's own events
 * (organizer_id-filtered read — rule #3: owner-facing list, nothing public).
 * Flat light CTA, no glow (rule #4). Bounded 50-row read, small by nature.
 */
export default function MyEventsScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const uid = session?.user.id ?? '';

  const query = useQuery({
    queryKey: eventKeys.byOrganizer(uid),
    queryFn: () => getEventsByOrganizer(supabase, uid),
    enabled: !!uid,
  });

  const events = query.data ?? [];

  return (
    <Screen>
      <ModalHeader title={t('live.mine.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-5 pb-16">
        <Button
          label={t('event.create.title', locale)}
          onPress={() => router.push('/(modal)/event-create')}
          variant="light"
        />

        {query.isLoading ? <ActivityIndicator color={semantic.aura} /> : null}

        {query.isError ? (
          <View className="items-center gap-4 pt-8">
            <EmptyState>{t('live.error', locale)}</EmptyState>
            <Button
              label={t('common.retry', locale)}
              variant="ghost"
              onPress={() => void query.refetch()}
            />
          </View>
        ) : null}

        {!query.isLoading && !query.isError && events.length === 0 ? (
          <View className="items-center pt-8">
            <EmptyState>{t('live.mine.empty', locale)}</EmptyState>
          </View>
        ) : null}

        {events.length > 0 ? (
          <View className="gap-3">
            <SectionLabel>{t('live.mine.section', locale)}</SectionLabel>
            {events.map((e) => (
              <EventRow
                key={e.id}
                data={{
                  id: e.id,
                  title: e.title,
                  category: e.category,
                  starts_at: e.starts_at,
                  venue: e.venue,
                  city: e.city,
                  is_online: e.is_online,
                  is_athanor_day: e.is_athanor_day,
                  premiumLocked: false,
                  live: !!e.live_started_at && !e.live_ended_at,
                }}
                locale={locale}
                onPress={() => router.push(EVENT_HREF(e.id))}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
