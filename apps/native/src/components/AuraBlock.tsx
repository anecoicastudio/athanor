import { Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

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
  return (
    <View className="items-center gap-1">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
        {label ?? t('profile.aura.label', locale)}
      </Text>
      <Text className="text-[44px] font-extrabold tracking-[-0.03em] text-foreground">{score}</Text>
      <Text className="text-[13px] text-aura">{t('profile.aura.how', locale)}</Text>
    </View>
  );
}
