import { useMemo, useState } from 'react';
import { ActivityIndicator, SectionList } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type LedgerCursor, type LedgerFilter, getAuraLedgerPage, ledgerKeys } from '@athanor/api';
import { galleria } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import type { AuraEvent, Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { LedgerRow } from '@/components/aura/LedgerRow';
import { Chip } from '@/components/Chip';
import { ListPageError } from '@/components/ListPageError';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { ShimmerBar } from '@/components/ShimmerBar';
import { useNow } from '@/hooks/use-now';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { dayKey, ledgerDayLabel } from '@/lib/time';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Section = { title: string; dayKey: string; data: AuraEvent[] };

const FILTERS: LedgerFilter[] = ['all', 'gained', 'decayed'];

// ---------------------------------------------------------------------------
// Shimmer placeholder
// ---------------------------------------------------------------------------

function ShimmerRows() {
  return (
    <View className="gap-3">
      <ShimmerBar width="w-1/3" />
      <ShimmerBar />
      <ShimmerBar />
      <ShimmerBar />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filter chip row
// ---------------------------------------------------------------------------

function FilterChips({
  active,
  onChange,
  locale,
}: {
  active: LedgerFilter;
  onChange: (f: LedgerFilter) => void;
  locale: Locale;
}) {
  // WRAPS rather than scrolls (#640): a horizontal ScrollView in this flex column grew to
  // fill the leftover height (325px of chip row). Same reasoning as BallotFilterChips —
  // DESIGN §6 reserves horizontal carousels for Home's event cards, and three chips fit one
  // line anyway.
  return (
    <View className="flex-row flex-wrap gap-2">
      {/* `Chip` (#635): these were bare Pressables, so the active filter reached a screen
          reader as a colour and nothing else — and at py-2 they sat under DESIGN §10's 44pt. */}
      {FILTERS.map((f) => (
        <Chip
          key={f}
          label={t(`ledger.filter.${f}` as MessageKey, locale)}
          selected={f === active}
          onPress={() => onChange(f)}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Aura ledger detail (M6 §3.2; Galleria, 2026-10-09, #921).
 * The member's OWN ledger, nobody else's: every read is keyed on the signed-in id.
 * One grey sentence and three filter chips head a cursor-paginated SectionList grouped by
 * calendar day, and scroll with it. A day is one group: its label 12 above, its rows as segments that touch
 * (`LedgerRow` draws its own, since the list pages), 26 before the next day.
 * Loading, empty and a failed first read take the list's place (`ListState`); a read that
 * fails with rows on screen says so under them (`ListPageError`).
 * Read-only — no Aura writes (rule #1). Engine is dormant; empty is the normal state.
 */
export default function LedgerScreen() {
  const { session } = useAuth();
  const locale = useLocale();
  const me = session?.user.id ?? '';

  const [filter, setFilter] = useState<LedgerFilter>('all');

  // Pinned for the screen's life so day-labels stay stable across sections.
  const nowMs = useNow();

  const query = useInfiniteQuery({
    queryKey: ledgerKeys.list(me, filter),
    queryFn: ({ pageParam }) =>
      getAuraLedgerPage(supabase, me, {
        cursor: pageParam as LedgerCursor | undefined,
        filter,
      }),
    initialPageParam: undefined as LedgerCursor | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!me,
  });

  // Flatten pages → rows.
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);

  // Group into SectionList sections by device-local calendar day.
  const sections: Section[] = useMemo(() => {
    if (rows.length === 0) return [];
    const map = new Map<string, Section>();
    const now = new Date(nowMs);
    for (const row of rows) {
      const key = dayKey(row.createdAt);
      if (!map.has(key)) {
        map.set(key, {
          title: ledgerDayLabel(row.createdAt, locale, now),
          dayKey: key,
          data: [],
        });
      }
      map.get(key)!.data.push(row);
    }
    return Array.from(map.values());
  }, [rows, locale, nowMs]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function handleEndReached() {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }

  const lastDay = sections[sections.length - 1]?.dayKey;

  return (
    <Screen>
      {/* Header */}
      <ModalHeader
        title={t('ledger.title', locale)}
        backLabel={t('common.back', locale)}
        fallbackHref="/(modal)/aura"
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 48 }}
        // The sentence and the chips scroll with the list. Pinned above it, at the largest
        // text size they left a list of 318pt for rows 218 tall (iPhone SE simulator, Expo Go,
        // 2026-10-09). The header stays mounted while the list is empty, so a filter with no
        // row can still be changed.
        ListHeaderComponent={
          <View className="gap-[26px] pb-[26px]">
            <Text className="type-small text-muted-foreground">{t('ledger.sub', locale)}</Text>
            <FilterChips active={filter} onChange={setFilter} locale={locale} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View className="bg-background pb-3">
            <SectionLabel heading>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          // 26 under a day's group, except the last: the list's own foot follows it.
          <View
            className={
              index === section.data.length - 1 && section.dayKey !== lastDay
                ? 'pb-[26px]'
                : undefined
            }
          >
            <LedgerRow
              type={item.type}
              points={item.points}
              createdAt={item.createdAt}
              locale={locale}
              first={index === 0}
              last={index === section.data.length - 1}
            />
          </View>
        )}
        stickySectionHeadersEnabled
        onEndReachedThreshold={0.4}
        onEndReached={handleEndReached}
        // Engine dormant: empty is the expected default, so it is said, not hidden.
        ListEmptyComponent={
          <ListState
            state={listState({
              status: query.status,
              fetchStatus: query.fetchStatus,
              isEmpty: rows.length === 0,
              staleWins: true,
            })}
            locale={locale}
            errorLabel={t('aura.error', locale)}
            emptyLabel={
              filter === 'all' ? t('ledger.empty', locale) : t('ledger.empty.filtered', locale)
            }
            onRetry={() => void query.refetch()}
            loading={<ShimmerRows />}
          />
        }
        // Rows in hand keep `ListEmptyComponent` from rendering: a failed later page, or a
        // failed refetch, says so under them.
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-6">
              <ActivityIndicator color={galleria.foreground} />
            </View>
          ) : (
            <ListPageError
              query={query}
              hasRows={rows.length > 0}
              label={t('aura.error', locale)}
              retryLabel={t('common.retry', locale)}
            />
          )
        }
      />
    </Screen>
  );
}
