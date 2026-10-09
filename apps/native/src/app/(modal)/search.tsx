import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { searchAll, searchKeys, type SearchCursor } from '@athanor/api';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { SearchResult, SearchScope } from '@athanor/schemas';
import { FlatList, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { SearchBar } from '@/components/search/SearchBar';
import { ScopeTabs } from '@/components/search/ScopeTabs';
import { ResultRow } from '@/components/search/ResultRow';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { Tag } from '@/components/Tag';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { CircleGate } from '@/components/circle/CircleGate';
import { useLocale } from '@/hooks/use-locale';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { type SearchFilterParams, parseFilters, serializeFilters } from '@/lib/search-filters';
import { Screen } from '@/components/Screen';

/**
 * Search modal screen (M8 §3.3 v-search).
 *
 * Layout top→bottom:
 *   1. Header row: the drawn back + SearchBar (controlled, screen owns debounce)
 *   2. ScopeTabs: a row of chips (all/people/projects/events/marketplace)
 *   3. CircleGate: non-member → quiet locked pill; member → «Filtri avanzati», a small
 *      outline pill, and under it the filters in force as quiet tags
 *   4. Results area: idle prompt | ListState (loading / error+retry / no-results) | one
 *      `RowGroup` per kind under its grey label, 26 apart
 *
 * Filters are round-tripped through route params (contract with Task 9 search-filters sheet).
 * The sheet navigates back to /search with updated auraMin/city/star params → this screen
 * re-derives `filters` from useLocalSearchParams and re-runs the query automatically.
 *
 * Galleria (2026-10-06, #921): no bordered card and no cyan on this screen. The matched words
 * are foreground in a result's grey line (`ResultRow`), and the filters in force are named by
 * their tags: the cyan dot the opener carried until that day is gone.
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
  const locale = useLocale();
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
    staleWins: true,
  });

  // ── Applied filter chips (summary row when filters are set) ──────────────────
  const filterChips: string[] = [];
  if (filtersFromParams?.auraMin)
    filterChips.push(t('search.filter.summary.aura', locale, { min: filtersFromParams.auraMin }));
  if (filtersFromParams?.city) filterChips.push(filtersFromParams.city);
  if (filtersFromParams?.star)
    filterChips.push(`★ ${t(`star.${filtersFromParams.star}` as Parameters<typeof t>[0], locale)}`);

  // Build params to pass into the filter sheet so it can pre-fill current values
  const filterSheetParams = serializeFilters(filtersFromParams ?? {});

  return (
    <Screen>
      <ModalHeader
        backLabel={t('common.back', locale)}
        titleSlot={
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
        }
      />

      {/* ── Scope chips ── */}
      <ScopeTabs scope={scope} onChange={setScope} locale={locale} />

      {/* ── CircleGate: advanced-filter pill, and the filters in force ──
          20 above: the chip row keeps 6 of its own under the chips, and blocks are 26 apart. */}
      <View className="gap-3 px-5 pb-[26px] pt-5">
        <CircleGate feature="advancedFilters" variant="pill" locale={locale}>
          {/* Member affordance: opens the filter sheet (Task 9 route) */}
          <View className="self-start">
            <Button
              variant="outline"
              size="sm"
              label={t('search.filters.open', locale)}
              onPress={() => {
                router.push({ pathname: '/search-filters', params: filterSheetParams });
              }}
            />
          </View>
        </CircleGate>
        {filterChips.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {filterChips.map((chip) => (
              <Tag key={chip} quiet label={chip} />
            ))}
          </View>
        ) : null}
      </View>

      {/* ── Results area ── */}
      {isIdle ? (
        <View className="flex-1 items-center px-8 pt-20">
          <EmptyState body={t('search.empty.sub', locale)}>
            {t('search.empty.title', locale)}
          </EmptyState>
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
              <ActivityIndicator color={galleria.foreground} />
            </View>
          }
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(section) => section.key}
          contentContainerClassName="gap-[26px] px-5 pb-12"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: section }) => (
            // `RowGroup`'s own label is not a heading; this one is (DESIGN §10), so the
            // label stands here, 12 above the block as `RowGroup` sets its own.
            <View className="gap-3">
              <SectionLabel heading>{t(section.labelKey, locale)}</SectionLabel>
              <RowGroup>
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
              </RowGroup>
            </View>
          )}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
        />
      )}
    </Screen>
  );
}
