import { useState } from 'react';
import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { CalendarPanel } from '@/components/live/CalendarPanel';
import { EVENT_HREF } from '@/components/live/EventRow';
import { MapPanel } from '@/components/live/MapPanel';
import { OnlinePanel } from '@/components/live/OnlinePanel';
import { PanelTabs, type LivePanel } from '@/components/live/PanelTabs';
import { VicinoPanel } from '@/components/live/VicinoPanel';
import { useAuth } from '@/lib/auth-context';
import { useEntitlement } from '@/hooks/use-entitlement';
import { HIT_SLOP } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

export default function LiveScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  const [panel, setPanel] = useState<LivePanel>('vicino');
  const { data: entitlement } = useEntitlement();
  const premiumEnabled = entitlement?.features.premiumEvents ?? false;

  return (
    <Screen>
      <ModalHeader
        title={t('live.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <Pressable
            onPress={() => router.push('/(modal)/my-events')}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('live.mine.title', locale)}
          >
            <Text className="text-[13px] text-aura">{t('live.mine.title', locale)}</Text>
          </Pressable>
        }
      />
      <View className="pb-3">
        <PanelTabs active={panel} onChange={setPanel} locale={locale} />
      </View>
      {panel === 'vicino' ? (
        <VicinoPanel locale={locale} onOpen={(id) => router.push(EVENT_HREF(id))} />
      ) : null}
      {panel === 'calendario' ? (
        <CalendarPanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
        />
      ) : null}
      {panel === 'mappa' ? (
        <MapPanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
        />
      ) : null}
      {panel === 'online' ? (
        <OnlinePanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
        />
      ) : null}
    </Screen>
  );
}
