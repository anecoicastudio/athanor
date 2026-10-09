import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConversationListItem } from '@athanor/schemas';
import { View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Row } from '@/components/Row';
import { timeAgo } from '@/lib/time';
import { wordLines } from '@/lib/word-lines';

/**
 * One conversation in the Messaggi list (DESIGN §8.8, §9 «Grouped rows»; #921): the 44 disc, the
 * name, one line of the last message, the time at the right. The whole row is one button that
 * opens the thread, so it draws no chevron and the disc's `Avatar` is `decorative`: the row's
 * label says the name, the line, the time and, when it applies, «Non letto».
 *
 * Unread is an 8px foreground dot at the right and nothing else (Marco, 2026-10-09): the line
 * stays grey, and the dot is not the Momento's cyan one (2026-10-05).
 *
 * The list is paged, so each row draws its own SEGMENT of the group instead of standing in a
 * `RowGroup` (`feed/Comment`'s recipe, 2026-10-06): `first` rounds the top, `last` the foot, and
 * every row but the first draws the hairline above itself. The list has no gap.
 */
export function ConversationRow({
  item,
  locale,
  unread,
  now,
  onPress,
  first = true,
  last = true,
}: {
  item: ConversationListItem;
  locale: Locale;
  unread: boolean;
  now: number;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  const preview = item.lastMessagePreview ?? t('messages.preview.fresh', locale);
  const time = timeAgo(item.lastMessageAt, locale, now);
  return (
    <View
      className={cn(
        'bg-surface px-4',
        first ? 'rounded-t-[28px]' : null,
        last ? 'rounded-b-[28px]' : null,
      )}
    >
      {first ? null : <View className="h-px bg-hair" />}
      <Row
        leading={
          <Avatar
            decorative
            handle={item.peerHandle}
            displayName={item.peerDisplayName}
            avatarPath={item.peerAvatarPath}
            size={44}
          />
        }
        title={name}
        // A lone-word handle ellipsizes (DESIGN §10); the row's label keeps it whole.
        titleLines={wordLines(name) === 1 ? 1 : undefined}
        description={preview}
        descriptionLines={1}
        value={time}
        showChevron={false}
        trailing={unread ? <View className="h-2 w-2 rounded-full bg-foreground" /> : undefined}
        accessibilityLabel={[name, preview, time, unread ? t('messages.a11y.unread', locale) : null]
          .filter(Boolean)
          .join(', ')}
        onPress={onPress}
      />
    </View>
  );
}
