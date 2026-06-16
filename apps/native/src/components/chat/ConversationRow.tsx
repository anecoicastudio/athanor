import { type Locale, t } from '@athanor/i18n';
import type { ConversationListItem } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/** Relative "time ago" in the row meta — localized via i18n (the day suffix differs IT/EN). */
function timeAgo(iso: string, now: number, locale: Locale): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('time.now', locale);
  if (s < 3600) return t('time.minutes', locale, { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hours', locale, { n: Math.floor(s / 3600) });
  return t('time.days', locale, { n: Math.floor(s / 86400) });
}

export function ConversationRow({
  item,
  locale,
  unread,
  now,
  onPress,
}: {
  item: ConversationListItem;
  locale: Locale;
  unread: boolean;
  now: number;
  onPress: () => void;
}) {
  const name = item.peerHandle ? `@${item.peerHandle}` : '—';
  const preview = item.lastMessagePreview ?? t('messages.preview.fresh', locale);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 py-3"
    >
      <Avatar handle={item.peerHandle} size={48} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-[15px] font-semibold text-foreground">{name}</Text>
          <Text className="text-[12px] text-faint">{timeAgo(item.lastMessageAt, now, locale)}</Text>
        </View>
        <Text
          numberOfLines={1}
          className={`text-[13px] ${unread ? 'text-foreground' : 'text-faint'}`}
        >
          {preview}
        </Text>
      </View>
      {unread ? (
        <View
          accessibilityLabel={t('messages.a11y.unread', locale)}
          className="h-2 w-2 rounded-full bg-aura"
        />
      ) : null}
    </Pressable>
  );
}
