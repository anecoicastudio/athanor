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
  onDelete,
  pending = false,
  locale,
}: {
  comment: PostComment;
  onReply?: (handle: string | null) => void;
  onDelete?: () => void;
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
      <View className="flex-row gap-4">
        {/* Both were 12px labels with no padding — ~15pt targets (§10). «Rispondi» also
        carried no accessibilityRole, so VoiceOver announced it as plain text. */}
        {onReply ? (
          <Pressable
            className="min-h-[44px] justify-center self-start"
            onPress={() => onReply(null)}
            accessibilityRole="button"
          >
            <Text className="text-[12px] text-muted-foreground">{t('comment.reply', locale)}</Text>
          </Pressable>
        ) : null}
        {onDelete ? (
          <Pressable
            className="min-h-[44px] justify-center self-start"
            onPress={onDelete}
            accessibilityRole="button"
          >
            <Text className="text-[12px] text-muted-foreground">{t('comment.delete', locale)}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
