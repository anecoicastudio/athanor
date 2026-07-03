import { Tabs } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { getMomentiDeck, momentiKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { supabase } from '@/lib/supabase';
import {
  CommunityGlyph,
  CostellazioniGlyph,
  HomeGlyph,
  MomentiGlyph,
  ProfiloGlyph,
} from '@/components/glyphs';

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
        // DESIGN §9 tab bar: active = foreground — cyan stays on the ✦ badge only.
        // Icons only: labels don't fit the 5-tab slot in either language
        // («Costellazioni»); titles still feed the a11y labels + screen headers.
        tabBarActiveTintColor: semantic.foreground,
        tabBarInactiveTintColor: semantic.foregroundMuted,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home', 'it'),
          tabBarIcon: ({ color, size }) => <HomeGlyph color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t('tabs.community', 'it'),
          tabBarIcon: ({ color, size }) => <CommunityGlyph color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="momenti"
        options={{
          title: t('tabs.momenti', 'it'),
          tabBarIcon: ({ color, size }) => <MomentiGlyph color={color} size={size} />,
          tabBarBadge: hasUnseen ? '✦' : undefined,
          tabBarBadgeStyle: { backgroundColor: 'transparent', color: semantic.aura },
          tabBarAccessibilityLabel: hasUnseen
            ? t('tabs.a11y.momentiUnread', 'it')
            : t('tabs.momenti', 'it'),
        }}
      />
      <Tabs.Screen
        name="costellazioni"
        options={{
          title: t('tabs.costellazioni', 'it'),
          tabBarIcon: ({ color, size }) => <CostellazioniGlyph color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile', 'it'),
          tabBarIcon: ({ color, size }) => <ProfiloGlyph color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
