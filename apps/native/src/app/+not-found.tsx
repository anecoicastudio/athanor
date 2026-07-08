import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notFound.home', locale)}
        onPress={() => router.replace('/(tabs)')}
        className="min-h-[44px] items-center justify-center rounded-full border border-hair bg-raise px-6"
      >
        <Text className="text-sm font-semibold text-foreground">{t('notFound.home', locale)}</Text>
      </Pressable>
    </View>
  );
}
