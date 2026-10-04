import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useLocale } from '@/hooks/use-locale';

/**
 * Unmatched-route catcher. Single-segment strays fall into `[handle].tsx`
 * (which rejects non-`@` paths), but multi-segment deep links with no route —
 * e.g. a future universal-link prefix claimed in AASA/intent filters before
 * its screen ships (every prefix claimed today has one, #544) — land here
 * instead of expo-router's unbranded default screen. Copy shares the web
 * `notFound.*` keys.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const locale = useLocale();

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-[26px] px-5">
        <View className="gap-2">
          <Text accessibilityRole="header" className="text-center type-h1 text-foreground">
            {t('notFound.title', locale)}
          </Text>
          <Text className="text-center type-small text-muted-foreground">
            {t('notFound.body', locale)}
          </Text>
        </View>
        {/* The one way out of a dead end is the screen's primary action. */}
        <View className="self-stretch">
          <Button label={t('notFound.home', locale)} onPress={() => router.replace('/(tabs)')} />
        </View>
      </View>
    </Screen>
  );
}
