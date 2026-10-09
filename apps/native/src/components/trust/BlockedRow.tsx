import { memberLabel } from '@athanor/core';
import type { BlockedListItem } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Row } from '@/components/Row';
import { HIT_SLOP } from '@/lib/a11y';
import { PRESS_DIM } from '@/lib/press';
import { wordLines } from '@/lib/word-lines';

/**
 * Single row in the blocked-profiles list (M9; DESIGN §8.13, §9 «Grouped rows»; #921): the 44
 * disc, the name, and «Sblocca» as an underlined link at the row's right (Marco, 2026-10-07:
 * a link, not a pill; unblocking is housekeeping and its confirm is the caller's). The row is
 * inert: nothing here opens a blocked profile. No cyan.
 *
 * The link is hand-rolled so that it ends on the row's edge; `Button ghost` centres its words
 * inside 24 of padding on each side. While the mutation is in flight the row's content dims to
 * 50% and the link is inert, so the member sees it working without losing the row.
 *
 * A row whose person has since been banned arrives as the #314 tombstone (identity NULL,
 * `removed` true) and reads `removedLabel` («Account rimosso») rather than the «—» a missing
 * profile renders — the ledger still names what it holds, and the row stays unblockable (#663).
 *
 * The list is paged, so each row draws its own SEGMENT of the group instead of standing in a
 * `RowGroup` (`feed/Comment`'s recipe, 2026-10-06): `first` rounds the top, `last` the foot, and
 * every row but the first draws the hairline above itself. The list has no gap.
 */
export function BlockedRow({
  item,
  unblockLabel,
  removedLabel,
  mutating,
  onUnblock,
  first = true,
  last = true,
}: {
  item: BlockedListItem;
  unblockLabel: string;
  removedLabel: string;
  mutating: boolean;
  onUnblock: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const name = item.removed
    ? removedLabel
    : (memberLabel(item.peerDisplayName, item.peerHandle) ?? '—');
  return (
    <View
      className={cn(
        'bg-surface px-4',
        first ? 'rounded-t-[28px]' : null,
        last ? 'rounded-b-[28px]' : null,
      )}
    >
      {first ? null : <View className="h-px bg-hair" />}
      <View className={mutating ? 'opacity-50' : undefined}>
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
          titleLines={wordLines(name) === 1 ? 1 : undefined}
          trailing={
            <Pressable
              accessibilityRole="button"
              disabled={mutating}
              hitSlop={HIT_SLOP}
              className={cn('min-h-[44px] justify-center', PRESS_DIM)}
              onPress={onUnblock}
            >
              <Text className="type-small text-foreground underline">{unblockLabel}</Text>
            </Pressable>
          }
        />
      </View>
    </View>
  );
}
