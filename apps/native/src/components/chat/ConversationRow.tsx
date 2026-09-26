import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConversationListItem } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/time';
import { wordLines } from '@/lib/word-lines';

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
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  const preview = item.lastMessagePreview ?? t('messages.preview.fresh', locale);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 py-3 min-h-[56px]"
    >
      <Avatar
        handle={item.peerHandle}
        displayName={item.peerDisplayName}
        avatarPath={item.peerAvatarPath}
        size={48}
      />
      <View className="flex-1 gap-0.5">
        {/* `gap-x-3` + `flex-wrap` (#847): the name and the time ran together at AX sizes; now
            the time keeps its distance and drops under the name when both no longer fit. A
            lone-word name ellipsizes and its label keeps it whole (DESIGN §10). */}
        <View className="flex-row flex-wrap items-center justify-between gap-x-3">
          <Text
            className="shrink text-[15px] font-semibold text-foreground"
            numberOfLines={wordLines(name)}
            accessibilityLabel={name}
          >
            {name}
          </Text>
          <Text className="text-[12px] text-faint">{timeAgo(item.lastMessageAt, locale, now)}</Text>
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
