import { Tabs } from 'expo-router';
import { t } from '@auria/i18n';
import { semantic } from '@auria/config';

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
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile', 'it') }} />
    </Tabs>
  );
}
