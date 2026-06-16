import { type Locale, t } from '@athanor/i18n';
import type { ConnectionRequestListItem } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/**
 * One incoming request in the Richieste inbox: avatar + @handle and inline
 * Accetta / Rifiuta actions. Both actions disable while a response is pending.
 */
export function ConnectionRequestRow({
  item,
  locale,
  onAccept,
  onDecline,
  pending = false,
}: {
  item: ConnectionRequestListItem;
  locale: Locale;
  onAccept: () => void;
  onDecline: () => void;
  pending?: boolean;
}) {
  const name = item.peerHandle ? `@${item.peerHandle}` : '—';
  return (
    <View className="flex-row items-center gap-3 py-3">
      <Avatar handle={item.peerHandle} size={48} />
      <Text className="flex-1 text-[15px] font-semibold text-foreground">{name}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('connection.a11y.accept', locale, { name })}
          disabled={pending}
          className={`items-center justify-center rounded-full bg-aura px-4 py-2 ${pending ? 'opacity-40' : ''}`}
          onPress={onAccept}
        >
          <Text className="text-[13px] font-semibold text-on-aura">
            {t('connection.accept', locale)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('connection.a11y.decline', locale, { name })}
          disabled={pending}
          className={`items-center justify-center rounded-full border border-hair px-4 py-2 ${pending ? 'opacity-40' : ''}`}
          onPress={onDecline}
        >
          <Text className="text-[13px] text-foreground">{t('connection.decline', locale)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
