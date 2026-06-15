import { Tabs } from 'expo-router';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';

export default function TabsLayout() {
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
      <Tabs.Screen name="costellazioni" options={{ title: t('tabs.costellazioni', 'it') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile', 'it') }} />
    </Tabs>
  );
}
