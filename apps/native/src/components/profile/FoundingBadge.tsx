import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { Tag } from '@/components/Tag';

/**
 * «Membro fondatore» — Prime Stelle cohort badge (frontend 10 §3.6 PS-2).
 * The shared `Tag`, foreground on a hairline pill: NOT a lit star, and not cyan (it is none of
 * the five marks, DESIGN §2.3). The badge is granted/cosmetic; stars are earned by the engine.
 * Zero Aura (rule #1). The wrapper keeps the pill as wide as its words inside a column.
 */
export function FoundingBadge({ locale }: { locale: Locale }) {
  return (
    <View className="flex-row">
      <Tag label={t('prime.badge', locale)} />
    </View>
  );
}
