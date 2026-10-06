import { useWindowDimensions } from 'react-native';
import { type Locale, t } from '@athanor/i18n';
import type { PostComment } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';

/**
 * One comment (frontend §3.3 / §4): commenter row + body + «Rispondi», on `surface` with a
 * post's insets (`FeedPost`). NO like count (rule #3). `onReply` prefills the input with a
 * mention. `pending` dims an optimistic row until the write settles.
 *
 * The prototype draws the replies as rows of ONE group (`RowGroup`'s shape: radius 28, 16
 * inside, a hairline between rows that stops 16 short of each edge). The screen that lists
 * them (`(modal)/post/[id]`) pages them through a virtualized list, so the group cannot be one
 * element: each comment draws its own SEGMENT of it instead (Marco, 2026-10-06). `first` rounds
 * the top, `last` rounds the foot, and every comment but the first draws the hairline above
 * itself. Both default to true, which is a block of its own. Segments must touch: the list
 * that holds them sets no gap between its items.
 */
export function Comment({
  comment,
  onReply,
  onDelete,
  pending = false,
  first = true,
  last = true,
  locale,
}: {
  comment: PostComment;
  onReply?: (handle: string | null) => void;
  onDelete?: () => void;
  pending?: boolean;
  first?: boolean;
  last?: boolean;
  locale: Locale;
}) {
  const large = stacksTrailing(useWindowDimensions().fontScale);
  return (
    <View
      className={cn(
        'bg-surface px-4',
        first ? 'rounded-t-[28px]' : null,
        last ? 'rounded-b-[28px]' : null,
      )}
    >
      {first ? null : <View className="h-px bg-hair" />}
      {/* The dim is the comment's, not the group's: the fill and the hairline stay whole. */}
      <View className="gap-[10px] py-[14px]" style={{ opacity: pending ? 0.5 : 1 }}>
        <PostAuthorRow authorId={comment.author_id} />
        <Text className="type-body text-foreground">{comment.body}</Text>
        {/* No row when the screen gives this comment no action: an empty row would still take
            the negative margin and pull the block's foot in. */}
        {onReply || onDelete ? (
          <View className={cn('flex-row gap-4', large ? null : '-my-3')}>
            {/* Each is a 44pt target with a role (§10): they were 12px labels with no padding and
                «Rispondi» had no role. `-my-3` on the row gives back what the targets add to a
                21pt line; not at the accessibility sizes, where the line fills its target. */}
            {onReply ? (
              <Pressable
                className={cn('min-h-[44px] min-w-[44px] justify-center self-start', PRESS_DIM)}
                onPress={() => onReply(null)}
                accessibilityRole="button"
              >
                <Text className="type-small text-muted-foreground">
                  {t('comment.reply', locale)}
                </Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable
                className={cn('min-h-[44px] min-w-[44px] justify-center self-start', PRESS_DIM)}
                onPress={onDelete}
                accessibilityRole="button"
              >
                <Text className="type-small text-muted-foreground">
                  {t('comment.delete', locale)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
