import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';

/**
 * «Membro fondatore» — Prime Stelle cohort badge (frontend 10 §3.6 PS-2).
 * A quiet Tag-style pill, NOT a lit star and NEVER glowing (rule #4): the badge
 * is granted/cosmetic; stars are earned by the engine. Zero Aura (rule #1).
 */
export function FoundingBadge({ locale }: { locale: Locale }) {
  return (
    <View className="rounded-full border border-hair bg-raise-2 px-4 py-1.5">
      <Text className="text-[13px] font-semibold text-aura">{t('prime.badge', locale)}</Text>
    </View>
  );
}
