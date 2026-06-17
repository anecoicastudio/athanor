import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SectionList } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type LedgerCursor, type LedgerFilter, getAuraLedgerPage, ledgerKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import type { AuraEvent, Locale } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { LedgerRow } from '@/components/aura/LedgerRow';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { dayKey, ledgerDayLabel } from '@/lib/relative-time';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Section = { title: string; dayKey: string; data: AuraEvent[] };

const FILTERS: LedgerFilter[] = ['all', 'gained', 'decayed'];

// ---------------------------------------------------------------------------
// Shimmer placeholder
// ---------------------------------------------------------------------------

function ShimmerBar({ width = 'w-full' }: { width?: string }) {
  return <View className={`h-5 rounded-sm bg-raise ${width}`} />;
}

function ShimmerRows() {
  return (
    <View className="gap-4 px-5 pt-4">
      <ShimmerBar width="w-1/3" />
      <ShimmerBar />
      <ShimmerBar />
      <ShimmerBar />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filter pill row
// ---------------------------------------------------------------------------

function FilterPills({
  active,
  onChange,
  locale,
}: {
  active: LedgerFilter;
  onChange: (f: LedgerFilter) => void;
  locale: Locale;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-5 py-3"
    >
      {FILTERS.map((f) => {
        const isActive = f === active;
        return (
          <Pressable
            key={f}
            onPress={() => onChange(f)}
            className={`rounded-ctl border px-4 py-2 ${
              isActive ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
            }`}
          >
            <Text className={`text-[13px] ${isActive ? 'text-aura' : 'text-faint'}`}>
              {t(`ledger.filter.${f}` as MessageKey, locale)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Aura ledger detail (M6 §3.2).
 * Cursor-paginated SectionList grouped by calendar day. Three filter pills.
 * Read-only — no Aura writes (rule #1). Engine is dormant; empty is the normal state.
 */
export default function LedgerScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const me = session?.user.id ?? '';

  const [filter, setFilter] = useState<LedgerFilter>('all');

  // Pin `now` for the whole render pass so day-labels are stable across sections.
  const nowRef = useRef(new Date());

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
    const now = nowRef.current;
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
  }, [rows, locale]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function handleEndReached() {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }

  const isEmpty = !query.isLoading && !query.isError && rows.length === 0;

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center gap-4 px-5 pb-2 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-2xl text-faint">‹</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-[17px] font-semibold text-foreground">
            {t('ledger.title', locale)}
          </Text>
          <Text className="text-[12px] text-faint">{t('ledger.sub', locale)}</Text>
        </View>
      </View>

      {/* Filter pills */}
      <FilterPills active={filter} onChange={setFilter} locale={locale} />

      {/* Loading shimmer */}
      {query.isLoading ? <ShimmerRows /> : null}

      {/* Error */}
      {query.isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <EmptyState>{t('aura.error', locale)}</EmptyState>
          <Button
            label={t('common.retry', locale)}
            variant="ghost"
            onPress={() => void query.refetch()}
          />
        </View>
      ) : null}

      {/* Empty state — engine dormant: this is the expected default */}
      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState>
            {filter === 'all' ? t('ledger.empty', locale) : t('ledger.empty.filtered', locale)}
          </EmptyState>
        </View>
      ) : null}

      {/* Loaded: day-grouped SectionList */}
      {!query.isLoading && !query.isError && !isEmpty ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          renderSectionHeader={({ section }) => (
            <View className="bg-background py-2">
              <Text className="text-[11px] font-semibold uppercase tracking-widest text-faint">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <LedgerRow
              type={item.type}
              points={item.points}
              createdAt={item.createdAt}
              locale={locale}
            />
          )}
          stickySectionHeadersEnabled
          onEndReachedThreshold={0.4}
          onEndReached={handleEndReached}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View className="py-6">
                <ActivityIndicator color={semantic.aura} />
              </View>
            ) : null
          }
        />
      ) : null}
    </View>
  );
}
