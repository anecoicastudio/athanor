import { t } from '@athanor/i18n';
import type { Locale, MomentoReason } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { momentoReasonText } from '@/lib/momenti-reason';

/**
 * One affinity reason (frontend §9): a ✓ and the reason text in one body line, both foreground
 * (#921, 2026-10-05: the tick was cyan, and cyan is five marks, DESIGN §2.3). The reasons
 * are the only "why this match" signal — there is no Aura number here (rule #1), and
 * since #273 no affinity number either: the card receives TERMS and localizes them
 * per render (`lib/momenti-reason.ts`), so an English deck never reads an Italian tag.
 * a11y label = «Motivo di affinità: <reason>» — and it needs `accessible` to be one (#635). A
 * plain `View` is not an accessibility element, so the label sat on a node VoiceOver never
 * focused: the row announced its two `Text` children (the tick was a `Text` of its own then)
 * separately and the «Motivo di affinità» framing was announced by nothing at all.
 *
 * Load-bearing under `MomentoCard`, which wraps nothing accessible around it.
 * `home/MomentiCard.tsx` rendered this row until 2026-10-05; it writes its one reason itself
 * now (#921).
 */
export function AffinityRow({ reason, locale }: { reason: MomentoReason; locale: Locale }) {
  const text = momentoReasonText(reason, locale);
  return (
    <View accessible accessibilityLabel={`${t('momenti.a11y.affinity', locale)}: ${text}`}>
      <Text className="type-body text-foreground">✓ {text}</Text>
    </View>
  );
}
