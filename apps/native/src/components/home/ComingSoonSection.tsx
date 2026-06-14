import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import { View } from '@/tw';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * Honest placeholder for a Home block whose data arrives in a later milestone
 * (countdown M7, Esplora Fase2/M8, week M6, nudge M3, Oggi M4). The Home is an
 * assembly host (PRD §3.2): M1 scaffolds every section in prototype order; each
 * milestone swaps its «Presto qui» card for the real block. No fake data.
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
