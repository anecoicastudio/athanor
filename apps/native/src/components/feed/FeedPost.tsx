import { useRouter } from 'expo-router';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Post } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { PostMedia } from '@/components/feed/PostMedia';

/**
 * One feed post (frontend §3.1). Author row + body + category + optional step flag +
 * a meta row (✦ affordance + «Rispondi» cue, both tap through to the detail). Anti-vanity
 * (rule #3): NO public reaction/Aura/comment count — the ✦ lit state + author-only count
 * live in the detail; the card stays count-free.
 */
export function FeedPost({ post, locale }: { post: Post; locale: Locale }) {
  const router = useRouter();
  const categoryLabel = t(`feed.filter.${post.category}` as MessageKey, locale);
  const openDetail = () => router.push(`/(modal)/post/${post.id}`);
  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <View className="flex-row items-center justify-between">
        <PostAuthorRow authorId={post.author_id} size="sm" />
        <Text className="text-[12px] uppercase tracking-wider text-faint">{categoryLabel}</Text>
      </View>

      <Pressable className="gap-3" onPress={openDetail}>
        {post.is_step ? (
          <Text className="text-[12px] text-aura">✦ {t('feed.flag.step', locale)}</Text>
        ) : null}
        <Text className="text-[15px] leading-6 text-foreground">{post.body}</Text>
        <PostMedia
          postId={post.id}
          postType={post.type}
          variant="card"
          locale={locale}
          onPress={openDetail}
        />
      </Pressable>

      {/* Meta row — ✦ affordance + open-thread cue; both open the detail. No public count. */}
      <View className="flex-row items-center gap-4 border-t border-hair pt-3">
        <Pressable
          className="min-h-[44px] min-w-[44px] items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={t('post.react.a11y', locale)}
          onPress={openDetail}
        >
          <Text className="text-[18px] text-faint">✦</Text>
        </Pressable>
        <Pressable className="min-h-[44px] justify-center" onPress={openDetail}>
          <Text className="text-[13px] text-muted-foreground">{t('comment.reply', locale)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
