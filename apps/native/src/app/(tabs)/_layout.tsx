import { Tabs } from 'expo-router';
import { t } from '@athanor/i18n';
import { galleria } from '@athanor/config';
import { View } from '@/tw';
import { NotificationRouter } from '@/components/boot/NotificationRouter';
import { PushPermissionAsk } from '@/components/boot/PushPermissionAsk';
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
  // The waiting-Momento dot: one 8px cyan dot on the Momenti glyph when ≥1 pending Momento
  // waits — never a numeric count (rule #3 / DESIGN §8). It was a ✦ in the navigator's badge
  // until Galleria (2026-10-04, #921). (tabs) renders inside the query provider.
  const deck = useMomentiDeck();
  const hasUnseen = (deck.data?.length ?? 0) > 0;
  const locale = useLocale();

  return (
    <>
      {/* The one notification-permission ask per install (#561). No UI since #908 (2026-10-01):
          it fires the OS dialog directly. Here and not in the root layout, so the dialog can
          only ever appear over the signed-in tab world — never the funnel or auth. */}
      <PushPermissionAsk />
      {/* Routes a tapped OS banner (#637). No UI; mounted here so it runs only once the guard
          has parked a complete profile in the authed world — see its docblock. */}
      <NotificationRouter />
      <Tabs
        screenOptions={{
          // No native title bar anywhere (DESIGN §6 → Screen headers, #162): tab roots
          // render their own in-content header and take their top inset from Screen.
          headerShown: false,
          // DESIGN §9 tab bar: the black ground under a 1px hairline (the prototype's
          // `.tabs { border-top: 1px solid var(--hair) }`). Its height is the navigator's.
          tabBarStyle: {
            backgroundColor: galleria.background,
            borderTopColor: galleria.hair,
            borderTopWidth: 1,
          },
          // Active = foreground, never cyan: the only cyan in the bar is the dot below.
          // Icons only: labels don't fit the 5-tab slot in either language
          // («Costellazioni»). So every tab names itself through `tabBarAccessibilityLabel`
          // (DESIGN §6): the bottom-tab bar derives a label from `title` on iOS ONLY
          // (`BottomTabBar.js`, `EXPO_OS === 'ios'`), and TalkBack read four unnamed tabs (#749).
          tabBarActiveTintColor: galleria.foreground,
          tabBarInactiveTintColor: galleria.foregroundMuted,
          tabBarShowLabel: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home', locale),
            tabBarAccessibilityLabel: t('tabs.home', locale),
            tabBarIcon: ({ color, size }) => <HomeGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: t('tabs.community', locale),
            tabBarAccessibilityLabel: t('tabs.community', locale),
            tabBarIcon: ({ color, size }) => <CommunityGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="momenti"
          options={{
            title: t('tabs.momenti', locale),
            // The dot stands off the glyph's top-right corner: 6 out, 4 up, where the
            // prototype puts it (`.tabs .dot { top: 6px; right: 6px }` in a 48×44 cell around
            // a 24 glyph). No label of its own: the tab's label below says a Momento waits.
            tabBarIcon: ({ color, size }) => (
              <View>
                <MomentiGlyph color={color} size={size} />
                {hasUnseen ? (
                  <View className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-aura" />
                ) : null}
              </View>
            ),
            tabBarAccessibilityLabel: hasUnseen
              ? t('tabs.a11y.momentiUnread', locale)
              : t('tabs.momenti', locale),
          }}
        />
        <Tabs.Screen
          name="costellazioni"
          options={{
            title: t('tabs.costellazioni', locale),
            tabBarAccessibilityLabel: t('tabs.costellazioni', locale),
            tabBarIcon: ({ color, size }) => <CostellazioniGlyph color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile', locale),
            tabBarAccessibilityLabel: t('tabs.profile', locale),
            tabBarIcon: ({ color, size }) => <ProfiloGlyph color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}
