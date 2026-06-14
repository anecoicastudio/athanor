import { Pressable, Text, View } from '@/tw';
import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/**
 * Il Sogno — the one active dream, in the owner's words (frontend `02` §3.1).
 * Editable (M2): tap the quote (or the empty-state CTA) to open the dream editor.
 * When `onEdit` is omitted the card renders read-only (e.g. future person-detail).
 */
export function DreamCard({
  dream,
  locale,
  onEdit,
}: {
  dream: string | null;
  locale: Locale;
  onEdit?: () => void;
}) {
  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
        {t('dream.ownLabel', locale)}
      </Text>
      {dream ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dream.editor.title', locale)}
          disabled={!onEdit}
          onPress={onEdit}
        >
          <Text className="font-dream text-xl leading-relaxed text-foreground">«{dream}»</Text>
        </Pressable>
      ) : (
        <View className="gap-3">
          <EmptyState>{t('dream.empty.title', locale)}</EmptyState>
          {onEdit ? (
            <Button label={t('dream.empty.cta', locale)} variant="primary" onPress={onEdit} />
          ) : null}
        </View>
      )}
    </View>
  );
}
