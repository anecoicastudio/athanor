import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Mandorla } from '@/components/Mandorla';
import { Button } from '@/components/Button';
import { deviceLocale } from '@/lib/locale';
import { useAnnounceOnMount, MODAL_A11Y } from '@/lib/a11y';

/**
 * Blocking force-update screen (frontend 12 §10.1). No dismiss; rendered as an overlay above the
 * navigator so there's no route to pop (Android back is a no-op, §2.4). Calm — Mandorla glow 0.
 */
export function ForceUpdateScreen() {
  useAnnounceOnMount(t('update.title', deviceLocale));

  const openStore = () => {
    // Android: the package id is known; iOS: the App Store id is assigned at submission —
    // see docs/RELEASE-RUNBOOK.md (R-5 / S-9). Falls back to the store search.
    const androidPkg = Constants.expoConfig?.android?.package ?? 'com.athanor.app';
    const url =
      Platform.OS === 'android'
        ? `https://play.google.com/store/apps/details?id=${androidPkg}`
        : 'https://apps.apple.com/app/athanor';
    void Linking.openURL(url);
  };

  return (
    <View
      className="flex-1 items-center justify-center bg-background px-8"
      accessibilityRole="alert"
      {...MODAL_A11Y}
    >
      <Mandorla size={120} glowLevel={0}>
        <View />
      </Mandorla>
      <Text
        className="mt-8 text-center text-2xl font-bold text-foreground"
        accessibilityRole="header"
      >
        {t('update.title', deviceLocale)}
      </Text>
      <Text className="mt-3 text-center text-base text-muted-foreground">
        {t('update.body', deviceLocale)}
      </Text>
      <View className="mt-8 w-full">
        <Button label={t('update.cta', deviceLocale)} variant="light" onPress={openStore} />
      </View>
    </View>
  );
}
