import { useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { memberLabel } from '@athanor/core';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Project } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { RowGroup } from '@/components/RowGroup';
import { Tag } from '@/components/Tag';
import { useProfile } from '@/hooks/use-profile';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';

/**
 * A project on the Costellazioni board — «Cerco videomaker / socio / investitore». Title +
 * category tag (spread row), grey description, author line. Tap → light project
 * detail. No vanity counts (rule #3).
 *
 * A borderless `surface` block of its own since 2026-10-05 (#921; DESIGN §8.9), the prototype's
 * `.rows > .row.col`: 14 above and below, 10 between its lines. The board has no bordered card
 * (Marco, that day). The author line is written here, a 30 disc and the name in small grey, and
 * not the shared `feed/PostAuthorRow`, whose name is 17/500: on a collaboration board the pitch
 * outranks the person (§8.9). Its 30pt line reaches 44 through `hitSlop`, 7 above and below,
 * inside the block's own 10 and 14, and it is as wide as its disc and name (`self-start`).
 *
 * The block is TWO controls, one above the other, not one wrapping the other (#635, #518). It
 * used to be a single `Pressable` with `PostAuthorRow` — itself a `Pressable` — inside it: on iOS an
 * accessible ancestor is atomic, so the author's profile was unreachable to VoiceOver, and the
 * whole card announced no role either. Silencing the inner row with `accessible={false}` would
 * have traded one defect for a quieter one and `source-audit.test.ts` fails a Pressable that is
 * both silenced and role-bearing. So the nesting is gone instead: the tap target is the content
 * block, and the author line is its sibling — `FeedPost`'s shape, the one the guard's own
 * message prescribes.
 *
 * No `accessibilityLabel` on the content block on purpose. An explicit label REPLACES the one
 * derived from children, so a static string would cost the title, the category and the
 * description — the three things the card is (`live/CalendarPanel.tsx`'s filter-pill label states
 * the same trade).
 */
export function ProjectCard({ project, locale }: { project: Project; locale: Locale }) {
  const router = useRouter();
  // At the accessibility sizes the category tag moves under the title (#847): beside it, the
  // `flex-1` title was left narrower than one long word and broke it mid-word («photograph /
  // er»). The title is a sentence, so it keeps every line — it just gets the block's width.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const { data: author } = useProfile(project.author_id);
  const handle = author?.handle ?? null;
  const authorName = author?.removed
    ? t('profile.removed.name', locale)
    : memberLabel(author?.display_name, handle);
  return (
    <RowGroup>
      <View className="gap-[10px] py-[14px]">
        <Pressable
          className={cn('gap-[10px]', PRESS_DIM)}
          accessibilityRole="button"
          onPress={() => router.push(`/(modal)/listing/${project.id}`)}
        >
          <View
            className={stacked ? 'items-start gap-2' : 'flex-row items-start justify-between gap-3'}
          >
            <Text
              className={cn('type-body font-medium text-foreground', stacked ? null : 'flex-1')}
            >
              {project.title}
            </Text>
            <Tag label={t(`costellazioni.filter.${project.category}` as MessageKey, locale)} />
          </View>
          {project.description ? (
            <Text className="type-small text-muted-foreground" numberOfLines={3}>
              {project.description}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          className={cn('flex-row items-center gap-[10px] self-start', PRESS_DIM)}
          hitSlop={{ top: 7, bottom: 7 }}
          accessibilityRole="button"
          accessibilityLabel={
            author?.removed || !authorName
              ? undefined
              : t('connection.a11y.open', locale, { name: authorName })
          }
          onPress={() => router.push(`/(modal)/user/${project.author_id}`)}
        >
          <Avatar
            decorative
            handle={handle}
            displayName={author?.display_name ?? null}
            avatarPath={author?.avatar_path ?? null}
            size={30}
          />
          <Text
            className="shrink type-small text-muted-foreground"
            numberOfLines={wordLines(authorName)}
            // The removed-author line has no label of its own, so the name must carry one.
            accessibilityLabel={authorName ?? undefined}
          >
            {authorName ?? '·'}
          </Text>
        </Pressable>
      </View>
    </RowGroup>
  );
}
