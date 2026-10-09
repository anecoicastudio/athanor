import { useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getProjectsPage, type ProjectCursor, projectKeys } from '@athanor/api';
import { galleria } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { FlatList, Text, View } from '@/tw';
import { useLocale } from '@/hooks/use-locale';
import { Button } from '@/components/Button';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { Screen } from '@/components/Screen';
import { ProjectCard } from '@/components/costellazioni/ProjectCard';
import {
  ProjectFilterTabs,
  type ProjectFilter,
} from '@/components/costellazioni/ProjectFilterTabs';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { SectionLabel } from '@/components/SectionLabel';
import { supabase } from '@/lib/supabase';
import { stacksTrailing } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';

const COMPOSE_HREF = '/(modal)/project-compose' as const;
const FAVOR_HREF = '/(modal)/favor' as const;

/**
 * The Costellazioni tab: the project board, with the way into Passa il Favore above it.
 *
 * Galleria since 2026-10-05 (#921; DESIGN §8.9): blocks 26 apart on a 20 gutter and NO bordered
 * card (Marco, that day). The favour band is one `Row` in a `RowGroup`; «+ Pubblica» is a small
 * outline pill beside the board's label; each project is a borderless block of its own
 * (`ProjectCard`). No cyan on this screen.
 */
export default function CostellazioniScreen() {
  const router = useRouter();
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const locale = useLocale();
  const title = t('costellazioni.title', locale);

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
      <Screen>
        <ListState
          state="error"
          locale={locale}
          errorLabel={t('costellazioni.error', locale)}
          onRetry={onRefresh}
          className="flex-1 justify-center px-5"
        />
      </Screen>
    );
  }

  const emptyTitle =
    filter === 'all'
      ? t('costellazioni.board.empty', locale)
      : t('feed.empty.cat.title', locale, {
          cat: t(`costellazioni.filter.${filter}` as MessageKey, locale),
        });

  return (
    <Screen>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View className="gap-[26px] pb-[26px] pt-4">
            <View className="gap-1 px-5">
              {/* h1 32/600 — the tab-root header recipe (DESIGN §6 → Screen headers). The
                  title is one long word, so `wordLines` holds it to one line (#754), and at
                  h1 that line is wider than an iPhone SE at AX5: on the simulator it broke as
                  «Costellazio / ni» unclamped (2026-10-05) and would end in an ellipsis
                  clamped. `adjustsFontSizeToFit` shrinks it only as far as the width asks,
                  so the screen's name stays whole: the one exception DESIGN §10 names to
                  its «no `adjustsFontSizeToFit`» (Marco, 2026-10-05). */}
              <Text
                accessibilityRole="header"
                className="type-h1 text-foreground"
                numberOfLines={wordLines(title)}
                adjustsFontSizeToFit
              >
                {title}
              </Text>
              <Text className="type-small text-muted-foreground">
                {t('costellazioni.sub', locale)}
              </Text>
            </View>
            {/* The chip row pads itself 6 above and below for its chips' `hitSlop`; the
                margin gives that back so the blocks stay 26 apart. */}
            <View className="-my-1.5">
              <ProjectFilterTabs active={filter} onChange={setFilter} locale={locale} />
            </View>
            {/* Passa il Favore — was the ListFooter of an INFINITE list (#640): every fetched
                page pushed it further away. A header row is always reachable. One row of a
                group, with `Row`'s chevron: navigation, not a moment. */}
            <View className="px-5">
              <RowGroup>
                <Row
                  title={t('costellazioni.favor.title', locale)}
                  description={t('costellazioni.favor.desc', locale)}
                  onPress={() => router.push(FAVOR_HREF)}
                />
              </RowGroup>
            </View>
            {/* Label left, pill right; the label takes the width that is left (`flex-1`), not
                the width of its words, and at the accessibility text sizes (`stacksTrailing`)
                the pill goes under it. Until 2026-10-05 the label ellipsized beside the
                control at those sizes (#754). */}
            <View
              className={
                stacked
                  ? 'items-start gap-2 px-5'
                  : 'flex-row items-center justify-between gap-3 px-5'
              }
            >
              <SectionLabel className={stacked ? undefined : 'flex-1'}>
                {t('costellazioni.board.label', locale)}
              </SectionLabel>
              <Button
                variant="outline"
                size="sm"
                label={t('costellazioni.publish', locale)}
                onPress={() => router.push(COMPOSE_HREF)}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-5 pb-[26px]">
            <ProjectCard project={item} locale={locale} />
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? null : (
            <View className="items-center px-5 pt-10">
              {/* Ghost action per DESIGN §9 — the framed cyan pill this replaced until #119 put
                  the loudest surface on the screen on an empty board. */}
              <EmptyState
                action={{
                  label: t('feed.empty.cat.cta', locale),
                  onPress: () => router.push(COMPOSE_HREF),
                }}
              >
                {emptyTitle}
              </EmptyState>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={onRefresh}
            tintColor={galleria.foreground}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        contentContainerClassName="pb-12"
      />
    </Screen>
  );
}
