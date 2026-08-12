import { useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type ContributionCursor, fundKeys, getMyContributions } from '@athanor/api';
import { formatPrice } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { FundContribution, Locale } from '@athanor/schemas';
import { FlatList, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { longDate } from '@/lib/time';
import { Screen } from '@/components/Screen';

function ReceiptRow({ row, locale }: { row: FundContribution; locale: Locale }) {
  const statusKey =
    row.status === 'succeeded'
      ? 'payments.status.succeeded'
      : row.status === 'refunded'
        ? 'payments.status.refunded'
        : 'payments.status.pending';
  const settled = row.status === 'succeeded';
  return (
    <View className="flex-row items-center justify-between border-b border-hair py-4">
      <View className="gap-1">
        <Text className="text-[15px] text-foreground">{longDate(row.created_at, locale)}</Text>
        <Text className="text-[12px] text-muted-foreground">{t(statusKey, locale)}</Text>
      </View>
      <Text
        className={`text-[15px] font-semibold ${settled ? 'text-foreground' : 'text-muted-foreground'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatPrice(row.amount_cents, row.currency, locale)}
      </Text>
    </View>
  );
}

/**
 * Pagamenti — owner-only contribution receipts (P4.4; frontend 07 §deferred).
 * Read-only history: rows are written only by the Stripe webhook (rule #6).
 * `pending` renders as «In arrivo», never an optimistic total — unreachable in practice, since
 * every enabled payment method settles on checkout.session.completed and assertSettled refuses
 * the rest; kept because `pending` is still the column DEFAULT. Keyset pagination on
 * (created_at, id) — never offset (rule #9). RLS scopes rows to the owner (rule #3).
 */
export default function PaymentsScreen() {
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const me = session?.user.id ?? '';

  const query = useInfiniteQuery({
    queryKey: fundKeys.myContributions(me),
    queryFn: ({ pageParam }) =>
      getMyContributions(supabase, me, { cursor: pageParam as ContributionCursor | undefined }),
    initialPageParam: undefined as ContributionCursor | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!me,
  });

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const isEmpty = !query.isLoading && !query.isError && rows.length === 0;

  return (
    <Screen>
      <ModalHeader
        title={t('settings.payments.title', locale)}
        backLabel={t('common.back', locale)}
      />

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={semantic.aura} />
        </View>
      ) : null}

      {query.isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <EmptyState>{t('payments.error', locale)}</EmptyState>
          <Button
            label={t('common.retry', locale)}
            variant="ghost"
            onPress={() => void query.refetch()}
          />
        </View>
      ) : null}

      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState>{t('payments.empty', locale)}</EmptyState>
        </View>
      ) : null}

      {!query.isLoading && !query.isError && !isEmpty ? (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          ListHeaderComponent={
            <View className="pb-2 pt-1">
              <SectionLabel>{t('payments.contributions.label', locale)}</SectionLabel>
            </View>
          }
          renderItem={({ item }) => <ReceiptRow row={item} locale={locale} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListFooterComponent={
            <View className="gap-4 pt-4">
              {query.isFetchingNextPage ? <ActivityIndicator color={semantic.aura} /> : null}
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.contribute.zeroAura', locale)}
              </Text>
            </View>
          }
        />
      ) : null}
    </Screen>
  );
}
