import { useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Post } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { PostMedia } from '@/components/feed/PostMedia';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { PRESS_DIM } from '@/lib/press';
import { STAR } from '@/lib/star';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * One feed post (frontend §3.1, DESIGN §8.3): a borderless `surface` block of its own, the
 * prototype's `.rows > .row.col` — 16 inside, 14 above and below, 10 between its lines. Not a
 * bordered card: Community has none (Marco, 2026-10-05). Author and category, the optional
 * step line, the body, the media, and a meta row (the ✧ and «Rispondi», both tap through to
 * the detail). Anti-vanity (rule #3): NO public reaction/Aura/comment count — the ✦ lit state
 * + author-only count live in the detail; the block stays count-free.
 *
 * «✦ Un passo del percorso» is cyan: one of the five marks of DESIGN §2.3, and the only cyan
 * on this screen.
 *
 * The author row, the body and the two meta controls are SIBLING press targets (#518): the
 * prototype makes the whole block one link, which would put the author's profile out of a
 * screen reader's reach.
 */
export function FeedPost({ post, locale }: { post: Post; locale: Locale }) {
  const router = useRouter();
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const categoryLabel = t(`feed.filter.${post.category}` as MessageKey, locale);
  const openDetail = () => router.push(`/(modal)/post/${post.id}`);
  return (
    <RowGroup>
      <View className="gap-[10px] py-[14px]">
        {/* Name left, category right. The author row takes the width that is left (`fill`):
            a text sized to its own words lost its last word on Android (moto g17, 2026-10-05,
            Home). At the accessibility sizes the category goes under the name (#847: a long
            name ran into the tag); never `flex-wrap`. */}
        <View className={cn(stacked ? 'gap-1' : 'flex-row items-center justify-between gap-3')}>
          <PostAuthorRow authorId={post.author_id} fill={!stacked} />
          <SectionLabel>{categoryLabel}</SectionLabel>
        </View>

        <Pressable className={cn('gap-[10px]', PRESS_DIM)} onPress={openDetail}>
          {post.is_step ? (
            <Text className="type-label text-aura">✦ {t('feed.flag.step', locale)}</Text>
          ) : null}
          <Text className="type-body text-foreground">{post.body}</Text>
          <PostMedia
            postId={post.id}
            postType={post.type}
            variant="card"
            locale={locale}
            onPress={openDetail}
          />
        </Pressable>

        {/* Meta row — star affordance left, open-thread cue right; both open the detail. No
            public count. The star's label is `post.react.a11yOpen`, NOT `post.react.a11y`:
            this control navigates, and «Accendi una stella» promised a toggle it doesn't
            perform. The real toggle is ReactionStar on the detail. Each is a 44pt target;
            `-my-3` gives back the 12 above and below that the targets add to a 21pt line, so
            the block ends 14 under the line as the prototype's does. Not at the accessibility
            sizes: the line is as tall as its target there (42 of 44 at AX5, iPhone SE
            simulator, 2026-10-05) and the margin would pull it onto the body. */}
        <View className={cn('flex-row items-center justify-between', stacked ? null : '-my-3')}>
          <Pressable
            className={cn(
              // 15 left puts the ✧ on the block's inset: on the moto g17 at a font scale of 1.0 its
              // glyph starts at 91px where the body starts at 90 (`a.py ax`, 2026-10-05).
              '-ml-[15px] min-h-[44px] min-w-[44px] items-center justify-center',
              PRESS_DIM,
            )}
            accessibilityRole="button"
            accessibilityLabel={t('post.react.a11yOpen', locale)}
            onPress={openDetail}
          >
            {/* ✧, not ✦: this block never receives the viewer's lit state, so it renders one
                glyph for every post. Under the ✦-lit/✧-unlit vocabulary (ReactionStar,
                the six stars' rows) a filled star here would claim "you lit this" on the whole feed. */}
            <Text className="type-small text-muted-foreground">{STAR.unlit}</Text>
          </Pressable>
          <Pressable
            className={cn('min-h-[44px] justify-center', PRESS_DIM)}
            accessibilityRole="button"
            onPress={openDetail}
          >
            <Text className="type-small text-muted-foreground">{t('comment.reply', locale)}</Text>
          </Pressable>
        </View>
      </View>
    </RowGroup>
  );
}
