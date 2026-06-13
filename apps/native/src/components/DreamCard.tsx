import { Text, View } from '@/tw';
import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import { EmptyState } from './EmptyState';

export function DreamCard({ dream, locale }: { dream: string | null; locale: Locale }) {
  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
        {t('profile.dream.mine', locale)}
      </Text>
      {dream ? (
        <Text className="font-dream text-xl leading-relaxed text-foreground">«{dream}»</Text>
      ) : (
        <EmptyState>{t('profile.dream.empty', locale)}</EmptyState>
      )}
    </View>
  );
}
