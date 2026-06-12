import { Tabs } from 'expo-router';
import { t } from '@kaira/i18n';
import { colors, semantic } from '@kaira/config';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bluNotte },
        headerTintColor: colors.avorio,
        tabBarStyle: { backgroundColor: semantic.surfaceMuted, borderTopColor: semantic.border },
        tabBarActiveTintColor: colors.oro,
        tabBarInactiveTintColor: semantic.foregroundMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home', 'it') }} />
      <Tabs.Screen name="community" options={{ title: t('tabs.community', 'it') }} />
      <Tabs.Screen name="live" options={{ title: t('tabs.live', 'it') }} />
      <Tabs.Screen name="momenti" options={{ title: t('tabs.momenti', 'it') }} />
      <Tabs.Screen name="profilo" options={{ title: t('tabs.profilo', 'it') }} />
    </Tabs>
  );
}
