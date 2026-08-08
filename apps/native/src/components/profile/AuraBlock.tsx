import { useRouter } from 'expo-router';
import { Pressable, Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { SectionLabel } from '@/components/SectionLabel';

export function AuraBlock({
  score,
  locale,
  label,
}: {
  score: number;
  locale: Locale;
  /** Override the heading (e.g. «la sua Aura» on a read-only person-detail). Defaults to the owner label. */
  label?: string;
}) {
  const router = useRouter();
  return (
    <View className="items-center gap-1">
      <SectionLabel>
        {label ?? t('profile.aura.label', locale)}
      </SectionLabel>
      <Text
        className="text-[44px] font-extrabold tracking-[-0.03em] text-foreground"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {score}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.aura.how', locale)}
        hitSlop={8}
        onPress={() => router.push('/aura')}
      >
        <Text className="text-[13px] text-aura">{t('profile.aura.how', locale)}</Text>
      </Pressable>
    </View>
  );
}
