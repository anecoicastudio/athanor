import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * Honest placeholder for a Home block whose data arrives in a later milestone. The Home is an
 * assembly host (PRD §3.2): M1 scaffolds every section in prototype order; each milestone swaps
 * its «Presto qui» card for the real block. No fake data.
 *
 * TWO callers remain, both `fallback` props: countdown M7 (`DreamHeroCard`) and Esplora Fase2/M8
 * (`PrimeStelleCard`). The week (M6) and nudge (M3) slots this used to cover have landed and were
 * swapped out in #100 / #99 — «Presto qui» over a shipped feature is a false claim, not a modest
 * one, so a landed block gets a real state or collapses. Don't wire this to a third slot without
 * checking that its milestone genuinely has not shipped.
 */
export function ComingSoonSection({ title, locale }: { title: string; locale: Locale }) {
  return (
    <View className="gap-3">
      <SectionLabel>{title}</SectionLabel>
      <Card>
        <EmptyState>{t('home.soon', locale)}</EmptyState>
      </Card>
    </View>
  );
}
