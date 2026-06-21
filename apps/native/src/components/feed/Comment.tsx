import { type Locale, t } from '@athanor/i18n';
import type { PostComment } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';

/**
 * One comment (frontend §3.3 / §4): commenter row + body + «Rispondi». NO like count
 * (the prototype's ♡ is dropped, §1.0). `onReply` prefills the input with a mention.
 * `pending` dims an optimistic row until the write settles.
 */
export function Comment({
  comment,
  onReply,
  pending = false,
  locale,
}: {
  comment: PostComment;
  onReply?: (handle: string | null) => void;
  pending?: boolean;
  locale: Locale;
}) {
  return (
    <View
      className="gap-2 rounded-card border border-hair bg-raise p-4"
      style={{ opacity: pending ? 0.5 : 1 }}
    >
      <PostAuthorRow authorId={comment.author_id} size="sm" />
      <Text className="text-[14px] leading-6 text-foreground">{comment.body}</Text>
      {onReply ? (
        <Pressable className="self-start" onPress={() => onReply(null)}>
          <Text className="text-[12px] text-muted-foreground">{t('comment.reply', locale)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
