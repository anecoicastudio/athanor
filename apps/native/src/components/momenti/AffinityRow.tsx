import { t } from '@athanor/i18n';
import type { Locale, MomentoReason } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { momentoReasonText } from '@/lib/momenti-reason';

/**
 * One affinity reason (frontend §9): a cyan ✓ glyph + the reason text. The reasons
 * are the only "why this match" signal — there is no Aura number here (rule #1), and
 * since #273 no affinity number either: the card receives TERMS and localizes them
 * per render (`lib/momenti-reason.ts`), so an English deck never reads an Italian tag.
 * a11y label = «Motivo di affinità: <reason>» — and it needs `accessible` to be one (#635). A
 * plain `View` is not an accessibility element, so the label sat on a node VoiceOver never
 * focused: the row announced its two `Text` children separately and the «Motivo di affinità»
 * framing was announced by nothing at all.
 *
 * Load-bearing under `MomentoCard`, which wraps nothing accessible around it. NOT under
 * `home/MomentiCard.tsx`, whose whole card is one atomic `Pressable` carrying a static label
 * that replaces every descendant on iOS — the framing still reaches nobody there, and that is
 * the deliberate one-node trade that card's own docblock argues for.
 */
export function AffinityRow({ reason, locale }: { reason: MomentoReason; locale: Locale }) {
  const text = momentoReasonText(reason, locale);
  return (
    <View
      accessible
      className="flex-row items-start gap-2 py-1"
      accessibilityLabel={`${t('momenti.a11y.affinity', locale)}: ${text}`}
    >
      <Text className="text-[15px] leading-[22px] text-aura">✓</Text>
      <Text className="flex-1 text-[14px] leading-[20px] text-faint">{text}</Text>
    </View>
  );
}
