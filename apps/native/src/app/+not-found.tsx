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
      <View className="flex-1 items-center justify-center gap-6 px-8">
        <Text className="text-center text-lg font-semibold text-foreground">
          {t('notFound.title', locale)}
        </Text>
        <Text className="text-center text-base text-muted-foreground">
          {t('notFound.body', locale)}
        </Text>
        <Button
          variant="outline"
          label={t('notFound.home', locale)}
          onPress={() => router.replace('/(tabs)')}
        />
      </View>
    </Screen>
  );
}
