import { Tabs } from 'expo-router';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { PushPrimer } from '@/components/boot/PushPrimer';
import { useLocale } from '@/hooks/use-locale';
import { useMomentiDeck } from '@/hooks/use-momenti-deck';
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
  const deck = useMomentiDeck();
  const hasUnseen = (deck.data?.length ?? 0) > 0;
  const locale = useLocale();

  return (
    <>
      {/* Notifications pre-permission primer (#561): here and not in the root layout, so it
          can only ever appear over the signed-in tab world — never the funnel or auth. */}
      <PushPrimer />
      <Tabs
        screenOptions={{
          // No native title bar anywhere (DESIGN §6 → Screen headers, #162): tab roots
          // render their own in-content header and take their top inset from Screen.
          // `title` stays — it feeds the tab-bar a11y labels.
          headerShown: false,
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
            title: t('tabs.home', locale),
            tabBarIcon: ({ color, size }) => <HomeGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: t('tabs.community', locale),
            tabBarIcon: ({ color, size }) => <CommunityGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="momenti"
          options={{
            title: t('tabs.momenti', locale),
            tabBarIcon: ({ color, size }) => <MomentiGlyph color={color} size={size} />,
            tabBarBadge: hasUnseen ? '✦' : undefined,
            tabBarBadgeStyle: { backgroundColor: 'transparent', color: semantic.aura },
            tabBarAccessibilityLabel: hasUnseen
              ? t('tabs.a11y.momentiUnread', locale)
              : t('tabs.momenti', locale),
          }}
        />
        <Tabs.Screen
          name="costellazioni"
          options={{
            title: t('tabs.costellazioni', locale),
            tabBarIcon: ({ color, size }) => <CostellazioniGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile', locale),
            tabBarIcon: ({ color, size }) => <ProfiloGlyph color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}
