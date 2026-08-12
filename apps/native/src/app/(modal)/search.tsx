import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { searchAll, searchKeys, type SearchCursor } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { SearchResult, SearchScope } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { SearchBar } from '@/components/search/SearchBar';
import { ScopeTabs } from '@/components/search/ScopeTabs';
import { ResultRow } from '@/components/search/ResultRow';
import { SectionLabel } from '@/components/SectionLabel';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { CircleGate } from '@/components/circle/CircleGate';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { type SearchFilterParams, parseFilters, serializeFilters } from '@/lib/search-filters';

/**
 * Search modal screen (M8 §3.3 v-search).
 *
 * Layout top→bottom:
 *   1. Header row: back chevron + SearchBar (controlled, screen owns debounce)
 *   2. ScopeTabs (all/people/projects/events/marketplace)
 *   3. CircleGate pill: non-member → quiet locked pill; member → «Filtri avanzati» opener
 *   4. Results area: idle prompt | ListState (loading / error+retry / no-results) | sections
 *
 * Filters are round-tripped through route params (contract with Task 9 search-filters sheet).
 * The sheet navigates back to /search with updated auraMin/city/star params → this screen
 * re-derives `filters` from useLocalSearchParams and re-runs the query automatically.
 *
 * Rule #4: NO glow on this screen. Only aura cyan is the SearchBar focus ring (in the
 * component) and highlighted match text (in ResultRow). No cyan fills, no auraSoft/auraLine
 * surfaces.
 */

type GroupSection = {
  key: SearchResult['entity_type'];
  labelKey: Parameters<typeof t>[0];
  rows: SearchResult[];
};

const GROUP_ORDER: SearchResult['entity_type'][] = ['person', 'project', 'event'];

const GROUP_LABEL: Record<SearchResult['entity_type'], Parameters<typeof t>[0]> = {
  person: 'search.group.people',
  project: 'search.group.projects',
  event: 'search.group.events',
};

function buildSections(rows: SearchResult[]): GroupSection[] {
  const buckets = new Map<SearchResult['entity_type'], SearchResult[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.entity_type);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(row.entity_type, [row]);
    }
  }
  return GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    labelKey: GROUP_LABEL[k],
    rows: buckets.get(k)!,
  }));
}

function deriveRoute(result: SearchResult): string {
  if (result.entity_type === 'person') return `/(modal)/user/${result.id}`;
  if (result.entity_type === 'event') return `/(modal)/event/${result.id}`;
  // project → the project detail modal (listing/[id] renders getProject).
  return `/(modal)/listing/${result.id}`;
}

export default function SearchScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();

  // ── Filters from route params (written back by search-filters sheet, Task 9) ──
  const params = useLocalSearchParams<SearchFilterParams>();
  const filtersFromParams = parseFilters(params);

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [rawInput, setRawInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce raw input → debouncedQ (~150 ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQ(rawInput);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [rawInput]);

  const q = debouncedQ.trim();
  const enabled = q.length >= 2;

  // ── Infinite query ────────────────────────────────────────────────────────────
  const query = useInfiniteQuery({
    queryKey: searchKeys.query(q, scope, filtersFromParams),
    queryFn: ({ pageParam }) =>
      searchAll(supabase, {
        q,
        scope,
        filters: filtersFromParams,
        cursor: pageParam,
      }),
    initialPageParam: null as SearchCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });

  const allRows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const sections = buildSections(allRows);

  // ── Derived state ─────────────────────────────────────────────────────────────
  // `isIdle` is the pre-query prompt («cerca una persona…»), not an empty result, so it stays
  // the caller's and is checked first. Everything after it goes through `listState`: the guard
  // here used to be `query.isFetched`, which is TRUE after a throw — so a search that failed
  // rendered «Nessun risultato per «{q}»», a claim about the world made from a broken pipe.
  const isIdle = !enabled;
  const hasResults = allRows.length > 0;
  const resultsState = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: !hasResults,
  });

  // ── Applied filter chips (summary row when filters are set) ──────────────────
  const hasFilters = filtersFromParams !== undefined;
  const filterChips: string[] = [];
  if (filtersFromParams?.auraMin)
    filterChips.push(t('search.filter.summary.aura', locale, { min: filtersFromParams.auraMin }));
  if (filtersFromParams?.city) filterChips.push(filtersFromParams.city);
  if (filtersFromParams?.star)
    filterChips.push(`★ ${t(`star.${filtersFromParams.star}` as Parameters<typeof t>[0], locale)}`);

  // Build params to pass into the filter sheet so it can pre-fill current values
  const filterSheetParams = serializeFilters(filtersFromParams ?? {});

  return (
    <View className="flex-1 bg-background">
      {/* ── Header row ── */}
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <View className="flex-1">
          <SearchBar
            value={rawInput}
            onChangeText={setRawInput}
            onClear={() => {
              setRawInput('');
              setDebouncedQ('');
            }}
            placeholder={t('search.placeholder', locale)}
            clearAccessibilityLabel={t('search.clear', locale)}
          />
        </View>
      </View>

      {/* ── Scope tabs ── */}
      <ScopeTabs scope={scope} onChange={setScope} locale={locale} />

      {/* ── CircleGate: advanced-filter pill ── */}
      <View className="px-5 pb-3 pt-1">
        <CircleGate feature="advancedFilters" variant="pill" locale={locale}>
          {/* Member affordance: opens the filter sheet (Task 9 route) */}
          <Pressable
            className="flex-row items-center gap-2 self-start rounded-full border border-hair bg-raise px-4 py-2.5"
            style={{ minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel={t('search.filters.open', locale)}
            onPress={() => {
              router.push({ pathname: '/search-filters', params: filterSheetParams });
            }}
          >
            <Text className="text-[14px] text-foreground">{t('search.filters.open', locale)}</Text>
            {hasFilters ? <View className="h-2 w-2 rounded-full bg-aura" /> : null}
          </Pressable>
        </CircleGate>
      </View>

      {/* ── Applied filter chips (summary row) ── */}
      {filterChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row gap-2 px-5 pb-3"
        >
          {filterChips.map((chip) => (
            <View key={chip} className="rounded-full border border-hair bg-raise-2 px-3 py-1">
              <Text className="text-[12px] text-muted-foreground">{chip}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* ── Results area ── */}
      {isIdle ? (
        <View className="flex-1 items-center px-8 pt-20">
          <EmptyState>{t('search.empty.title', locale)}</EmptyState>
          <Text className="mt-1 text-center text-[13px] text-faint">
            {t('search.empty.sub', locale)}
          </Text>
        </View>
      ) : resultsState !== 'ready' ? (
        <ListState
          state={resultsState}
          locale={locale}
          errorLabel={t('search.error', locale)}
          emptyLabel={t('search.noResults.title', locale, { q })}
          emptyBody={t('search.noResults.sub', locale)}
          onRetry={() => void query.refetch()}
          className="flex-1 px-8 pt-20"
          loading={
            <View className="flex-1 items-center pt-20">
              <ActivityIndicator color={semantic.aura} />
            </View>
          }
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(section) => section.key}
          contentContainerClassName="pb-10"
          renderItem={({ item: section }) => (
            <View className="mb-4">
              <View className="px-5 pb-2 pt-3">
                <SectionLabel>{t(section.labelKey, locale)}</SectionLabel>
              </View>
              {section.rows.map((result) => (
                <ResultRow
                  key={result.id}
                  result={result}
                  query={q}
                  onPress={(r) => {
                    router.push(deriveRoute(r) as Parameters<typeof router.push>[0]);
                  }}
                />
              ))}
            </View>
          )}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
        />
      )}
    </View>
  );
}
