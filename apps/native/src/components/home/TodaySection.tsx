import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventsCalendar } from '@athanor/api';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { EventRow } from '@/components/live/EventRow';
import { SectionLabel } from '@/components/SectionLabel';
import { ListState } from '@/components/ListState';
import { Card } from '@/components/Card';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';

const LIVE_HREF = '/(modal)/live' as const;

/**
 * Home «Oggi» — the next upcoming events + an entry into Athanor Live (M4 fill of the M1 stub).
 *
 * The section had ONE non-data branch and three situations fell into it: still loading, the
 * read threw, and there genuinely are no events (#111). All three said «Nessun evento in
 * programma», the third of which is the only one that was ever true.
 */
export function TodaySection({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: eventKeys.today(),
    queryFn: () => getEventsCalendar(supabase, null, 3),
  });
  const events = query.data?.events ?? [];
  const state = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: events.length === 0,
  });

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('home.today.title', locale)}</SectionLabel>
        <Pressable
          onPress={() => router.push(LIVE_HREF)}
          hitSlop={HIT_SLOP}
          accessibilityRole="link"
        >
          <Text className="text-[13px] text-aura">{t('home.today.seeLive', locale)}</Text>
        </Pressable>
      </View>
      {state !== 'ready' ? (
        <Card>
          <ListState
            state={state}
            locale={locale}
            errorLabel={t('live.error', locale)}
            emptyLabel={t('home.today.empty', locale)}
            onRetry={() => void query.refetch()}
            className="py-2"
          />
        </Card>
      ) : (
        <View className="gap-3">
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
              }}
              locale={locale}
              onPress={() => router.push(`/(modal)/event/${e.id}`)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
