import { useState } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getProjectsPage, type ProjectCursor, projectKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { ProjectCard } from '@/components/costellazioni/ProjectCard';
import {
  ProjectFilterTabs,
  type ProjectFilter,
} from '@/components/costellazioni/ProjectFilterTabs';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const COMPOSE_HREF = '/(modal)/project-compose' as const;
const FAVOR_HREF = '/(modal)/favor' as const;

export default function CostellazioniScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const locale = profile?.locale ?? 'it';

  const query = useInfiniteQuery({
    queryKey: projectKeys.list(filter),
    queryFn: ({ pageParam }) =>
      getProjectsPage(supabase, { category: filter, cursor: pageParam as ProjectCursor | null }),
    initialPageParam: null as ProjectCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const projects = query.data?.pages.flatMap((p) => p.projects) ?? [];
  const onRefresh = () => void query.refetch();

  if (query.isError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-5">
        <EmptyState>{t('costellazioni.error', locale)}</EmptyState>
        <Pressable
          className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
          onPress={onRefresh}
        >
          <Text className="text-[13px] text-aura">{t('feed.retry', locale)}</Text>
        </Pressable>
      </View>
    );
  }

  const emptyTitle =
    filter === 'all'
      ? t('costellazioni.board.empty', locale)
      : t('feed.empty.cat.title', locale, {
          cat: t(`costellazioni.filter.${filter}` as MessageKey, locale),
        });

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View className="gap-4 py-4">
            <View className="gap-1 px-5">
              <Text className="text-3xl text-foreground">{t('costellazioni.title', locale)}</Text>
              <Text className="text-[14px] text-faint">{t('costellazioni.sub', locale)}</Text>
            </View>
            <ProjectFilterTabs active={filter} onChange={setFilter} locale={locale} />
            <View className="flex-row items-center justify-between px-5">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                {t('costellazioni.board.label', locale)}
              </Text>
              <Pressable onPress={() => router.push(COMPOSE_HREF)} hitSlop={8}>
                <Text className="text-[13px] text-aura">{t('costellazioni.publish', locale)}</Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-5 pb-4">
            <ProjectCard project={item} locale={locale} />
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? null : (
            <View className="items-center gap-4 px-5 pt-16">
              <EmptyState>{emptyTitle}</EmptyState>
              <Pressable
                className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
                onPress={() => router.push(COMPOSE_HREF)}
              >
                <Text className="text-[13px] text-aura">{t('feed.empty.cat.cta', locale)}</Text>
              </Pressable>
            </View>
          )
        }
        ListFooterComponent={
          // Flat surface — navigation into the Passa il Favore sheet, NOT a moment (rule #4): no glow.
          <View className="px-5 pb-2 pt-2">
            <Pressable
              onPress={() => router.push(FAVOR_HREF)}
              accessibilityRole="button"
              accessibilityLabel={t('costellazioni.favor.title', locale)}
              className="gap-1 rounded-card bg-surface-muted px-5 py-4"
            >
              <Text className="text-[15px] text-foreground">
                {t('costellazioni.favor.title', locale)}
              </Text>
              <Text className="text-[13px] text-faint">
                {t('costellazioni.favor.desc', locale)}
              </Text>
            </Pressable>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={onRefresh}
            tintColor={semantic.aura}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        contentContainerClassName="pb-[104px]"
      />
    </View>
  );
}
