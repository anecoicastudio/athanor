import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { MandorlaMark } from '@/components/MandorlaMark';
import { Button } from '@/components/Button';
import { deviceLocale } from '@/lib/locale';
import { useAnnounceOnMount, MODAL_A11Y } from '@/lib/a11y';
import { appStoreGetUrl } from '@/lib/links';

/**
 * Blocking force-update screen (frontend 12 §10.1). No dismiss; rendered as an overlay above the
 * navigator so there's no route to pop (Android back is a no-op, §2.4). Calm — the outline mandorla.
 */
export function ForceUpdateScreen() {
  useAnnounceOnMount(t('update.title', deviceLocale));

  const openStore = () => {
    // Android: Play's URL carries no country. iOS: an App Store URL does, so it goes through
    // the site's `/get` (`appStoreGetUrl` in `lib/links.ts`).
    const androidPkg = Constants.expoConfig?.android?.package ?? 'world.athanor.app';
    const url =
      Platform.OS === 'android'
        ? `https://play.google.com/store/apps/details?id=${androidPkg}`
        : appStoreGetUrl(deviceLocale);
    void Linking.openURL(url);
  };

  return (
    <View
      className="flex-1 items-center justify-center bg-background px-8"
      accessibilityRole="alert"
      {...MODAL_A11Y}
    >
      <MandorlaMark />
      <Text className="mt-8 text-center type-h2 text-foreground" accessibilityRole="header">
        {t('update.title', deviceLocale)}
      </Text>
      <Text className="mt-3 text-center type-small text-muted-foreground">
        {t('update.body', deviceLocale)}
      </Text>
      <View className="mt-8 w-full">
        <Button label={t('update.cta', deviceLocale)} variant="primary" onPress={openStore} />
      </View>
    </View>
  );
}
