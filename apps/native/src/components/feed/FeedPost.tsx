import { type Href, useRouter } from 'expo-router';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Post } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';

/**
 * One feed post. Anti-vanity (rule #3): NO public reaction/Aura/comment count —
 * only body, category, and the optional "step" flag. The ✦ count and the
 * author-only Aura strip belong to the reactions-comments slice (author-gated).
 * The author handle/name needs a profile join — deferred to a later slice; this
 * one queries `posts` only.
 */
export function FeedPost({ post, locale }: { post: Post; locale: Locale }) {
  const router = useRouter();
  const categoryLabel = t(`feed.filter.${post.category}` as MessageKey, locale);
  return (
    <Pressable
      className="gap-3 rounded-card border border-hair bg-raise p-5"
      // post/[id] detail modal lands in a sibling M3 slice — forward-referenced.
      onPress={() => router.push(`/(modal)/post/${post.id}` as unknown as Href)}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-[12px] uppercase tracking-wider text-faint">{categoryLabel}</Text>
        {post.is_step ? (
          <Text className="text-[12px] text-aura">✦ {t('feed.flag.step', locale)}</Text>
        ) : null}
      </View>
      <Text className="text-[15px] leading-6 text-foreground">{post.body}</Text>
    </Pressable>
  );
}
