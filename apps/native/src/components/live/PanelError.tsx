import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';

/** Shared error state for the Live panels: message + retry CTA. */
export function PanelError({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-5">
      <EmptyState>{t('live.error', locale)}</EmptyState>
      <Pressable
        className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
        onPress={onRetry}
      >
        <Text className="text-[13px] text-aura">{t('common.retry', locale)}</Text>
      </Pressable>
    </View>
  );
}
