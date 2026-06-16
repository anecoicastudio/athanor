import { useRouter } from 'expo-router';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { Project } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';

/**
 * A Costellazioni board card — «Cerco videomaker / socio / investitore». Title +
 * category chip (spread row), muted description, author row. Tap → light project
 * detail. No vanity counts (rule #3).
 */
export function ProjectCard({ project, locale }: { project: Project; locale: Locale }) {
  const router = useRouter();
  return (
    <Pressable
      className="gap-3 rounded-card border border-hair bg-raise p-5"
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
      <PostAuthorRow authorId={project.author_id} size="sm" />
    </Pressable>
  );
}
