import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';

/**
 * One affinity reason (frontend §9): a cyan ✓ glyph + the reason text. The reasons
 * are the only "why this match" signal — there is no Aura number here (rule #1).
 * a11y label = «Motivo di affinità: <reason>».
 */
export function AffinityRow({ reason, locale }: { reason: string; locale: Locale }) {
  return (
    <View
      className="flex-row items-start gap-2 py-1"
      accessibilityLabel={`${t('momenti.a11y.affinity', locale)}: ${reason}`}
    >
      <Text className="text-[15px] leading-[22px] text-aura">✓</Text>
      <Text className="flex-1 text-[14px] leading-[20px] text-faint">{reason}</Text>
    </View>
  );
}
