import { useRouter } from 'expo-router';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Project } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';

/**
 * A Costellazioni board card — «Cerco videomaker / socio / investitore». Title +
 * category chip (spread row), muted description, author row. Tap → light project
 * detail. No vanity counts (rule #3).
 *
 * The card is TWO controls side by side, not one wrapping the other (#635, #518). It used to be
 * a single `Pressable` with `PostAuthorRow` — itself a `Pressable` — inside it: on iOS an
 * accessible ancestor is atomic, so the author's profile was unreachable to VoiceOver, and the
 * whole card announced no role either. Silencing the inner row with `accessible={false}` would
 * have traded one defect for a quieter one and `source-audit.test.ts` fails a Pressable that is
 * both silenced and role-bearing. So the nesting is gone instead: the tap target is the content
 * block, and the author row is its sibling — `FeedPost`'s shape, the one the guard's own message
 * prescribes.
 *
 * No `accessibilityLabel` on the content block on purpose. An explicit label REPLACES the one
 * derived from children, so a static string would cost the title, the category and the
 * description — the three things the card is (`CalendarPanel.tsx:63-70` states the same trade).
 */
export function ProjectCard({ project, locale }: { project: Project; locale: Locale }) {
  const router = useRouter();
  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <Pressable
        className="gap-3"
        accessibilityRole="button"
        onPress={() => router.push(`/(modal)/listing/${project.id}`)}
      >
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 text-[16px] font-semibold text-foreground">{project.title}</Text>
          <View className="rounded-ctl border border-hair bg-background px-3 py-1">
            <Text className="text-[12px] text-faint">
              {t(`costellazioni.filter.${project.category}` as MessageKey, locale)}
            </Text>
          </View>
        </View>
        {project.description ? (
          <Text className="text-[14px] text-faint" numberOfLines={3}>
            {project.description}
          </Text>
        ) : null}
      </Pressable>
      <PostAuthorRow authorId={project.author_id} size="sm" />
    </View>
  );
}
