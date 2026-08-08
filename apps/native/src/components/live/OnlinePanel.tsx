import { ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventsOnline } from '@athanor/api';
import { semantic } from '@athanor/config';
import { type Locale, t } from '@athanor/i18n';
import { ScrollView, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { supabase } from '@/lib/supabase';
import { EventRow, toRowData } from './EventRow';
import { LiveEventRow } from './LiveEventRow';
import { PanelError } from './PanelError';

/* ── Online ── */
export function OnlinePanel({
  locale,
  onOpen,
  premiumEnabled,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
}) {
  const query = useQuery({
    queryKey: eventKeys.online(),
    queryFn: () => getEventsOnline(supabase),
  });
  const all = query.data ?? [];
  const liveNow = all.filter((e) => e.live_started_at && !e.live_ended_at);
  const upcoming = all.filter((e) => !(e.live_started_at && !e.live_ended_at));

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <ScrollView contentContainerClassName="pb-[104px] gap-4">
      <View className="gap-3 px-5">
        <SectionLabel>
          {t('live.online.section', locale)}
        </SectionLabel>
        {liveNow.map((e) => (
          <LiveEventRow key={e.id} event={e} locale={locale} onOpen={onOpen} />
        ))}
        {upcoming.map((e) => (
          <EventRow
            key={e.id}
            data={toRowData(e, premiumEnabled)}
            locale={locale}
            onPress={() => onOpen(e.id)}
          />
        ))}
        {all.length === 0 && !query.isLoading ? (
          <EmptyState>{t('live.calendar.empty', locale)}</EmptyState>
        ) : null}
        {query.isLoading ? <ActivityIndicator color={semantic.aura} /> : null}
      </View>
    </ScrollView>
  );
}
