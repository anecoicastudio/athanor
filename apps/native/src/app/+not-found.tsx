import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';

/**
 * Unmatched-route catcher. Single-segment strays fall into `[handle].tsx`
 * (which rejects non-`@` paths), but multi-segment deep links with no route —
 * e.g. the `/momento/*` universal-link prefix declared in AASA/intent filters
 * before the momento share surface ships — land here instead of expo-router's
 * unbranded default screen. Copy shares the web `notFound.*` keys.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
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
  );
}
