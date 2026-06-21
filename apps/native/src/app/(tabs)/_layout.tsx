import { Tabs } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { getMomentiDeck, momentiKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { supabase } from '@/lib/supabase';

export default function TabsLayout() {
  // ✦ badge: light a single cyan spark when ≥1 pending Momento waits — never a
  // numeric count (rule #3 / DESIGN §8). (tabs) renders inside the query provider.
  const deck = useQuery({ queryKey: momentiKeys.deck(), queryFn: () => getMomentiDeck(supabase) });
  const hasUnseen = (deck.data?.length ?? 0) > 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: semantic.background },
        headerTintColor: semantic.foreground,
        tabBarStyle: { backgroundColor: semantic.surfaceMuted, borderTopColor: semantic.border },
        tabBarActiveTintColor: semantic.aura,
        tabBarInactiveTintColor: semantic.foregroundMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home', 'it') }} />
      <Tabs.Screen name="community" options={{ title: t('tabs.community', 'it') }} />
      <Tabs.Screen
        name="momenti"
        options={{
          title: t('tabs.momenti', 'it'),
          tabBarBadge: hasUnseen ? '✦' : undefined,
          tabBarBadgeStyle: { backgroundColor: 'transparent', color: semantic.aura },
          tabBarAccessibilityLabel: hasUnseen
            ? t('tabs.a11y.momentiUnread', 'it')
            : t('tabs.momenti', 'it'),
        }}
      />
      <Tabs.Screen name="costellazioni" options={{ title: t('tabs.costellazioni', 'it') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile', 'it') }} />
    </Tabs>
  );
}
