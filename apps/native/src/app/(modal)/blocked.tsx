import { useState } from 'react';
import { Alert } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blockKeys, listBlocked, unblockUser } from '@athanor/api';
import { t } from '@athanor/i18n';
import { FlatList } from '@/tw';
import { ListPageError } from '@/components/ListPageError';
import { ListState } from '@/components/ListState';
import { BlockedRow } from '@/components/trust/BlockedRow';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { invalidateBlockDependents } from '@/lib/block-cache';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

/**
 * Blocked-profiles list screen (M9 §3.1; DESIGN §8.13, #921). Keyset pagination (rule #9).
 * One group of rows on the stage, no bordered card, no cyan. The list is paged, so a row draws
 * its own segment of the group and the list has no gap. Unblock requires a destructive Alert
 * confirm before firing the mutation; the touched row dims while in flight.
 *
 * The empty branch goes through `listState` rather than `!isLoading` (#111). This is the
 * screen where that mattered most: «Non hai bloccato nessuno» rendered on a failed read is
 * a false all-clear, and someone checking whether they are still protected has no way to
 * tell it from the truth.
 */
export default function BlockedScreen() {
  const locale = useLocale();
  const qc = useQueryClient();
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const { showToast } = useToast();

  // ── Blocked list (keyset, created_at desc) ────────────────────────────────
  const query = useInfiniteQuery({
    queryKey: blockKeys.list(),
    queryFn: ({ pageParam }) => listBlocked(supabase, pageParam ?? undefined),
    initialPageParam: undefined as { createdAt: string; id: string } | undefined,
    getNextPageParam: (last) => {
      const tail = last.items.at(-1);
      return tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
    },
  });
  // `excluded` (a row the schema no longer recognises) has no surface on this screen; the list
  // stays up with the rows that parsed, which is the api.md trade the reader makes for lists.
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];

  // ── Unblock mutation ──────────────────────────────────────────────────────
  const unblock = useMutation({
    mutationFn: (peerId: string) => unblockUser(supabase, peerId),
    onMutate: (peerId) => setMutatingId(peerId),
    onSettled: () => setMutatingId(null),
    // Not only the list: the person's cached `null` profile has to go too, or they stay
    // «non disponibile» for the rest of `useProfile`'s window (see block-cache.ts).
    onSuccess: (_, peerId) => {
      invalidateBlockDependents(qc, peerId);
      showToast(t('block.toast.unblocked', locale), 'success');
    },
  });

  const confirmUnblock = (peerId: string, name: string | null) =>
    Alert.alert(t('block.unblock.confirm', locale, { name: name ?? '' }), undefined, [
      { text: t('common.cancel', locale), style: 'cancel' },
      {
        text: t('block.unblock', locale),
        style: 'destructive',
        onPress: () => unblock.mutate(peerId),
      },
    ]);

  return (
    <Screen>
      {/* Header */}
      <ModalHeader
        title={t('block.list.title', locale)}
        backLabel={t('common.back', locale)}
        fallbackHref="/(modal)/settings"
      />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="grow px-5 pb-12"
        renderItem={({ item, index }) => (
          <BlockedRow
            item={item}
            unblockLabel={t('block.unblock', locale)}
            removedLabel={t('profile.removed.name', locale)}
            mutating={mutatingId === item.peerId}
            first={index === 0}
            last={index === rows.length - 1}
            onUnblock={() =>
              confirmUnblock(
                item.peerId,
                // The dialog names what the row names: a tombstone's handle is NULL by design.
                item.removed ? t('profile.removed.name', locale) : item.peerHandle,
              )
            }
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          <ListState
            state={listState({
              status: query.status,
              fetchStatus: query.fetchStatus,
              isEmpty: rows.length === 0,
              staleWins: true,
            })}
            locale={locale}
            errorLabel={t('block.list.error', locale)}
            emptyLabel={t('block.list.empty', locale)}
            onRetry={() => void query.refetch()}
          />
        }
        // Rows in hand keep `ListEmptyComponent` from rendering: a failed later page, or a failed
        // refetch, says so under them. Here most of all a silent failure reads as «that is all».
        ListFooterComponent={
          <ListPageError
            query={query}
            hasRows={rows.length > 0}
            label={t('block.list.error', locale)}
            retryLabel={t('common.retry', locale)}
          />
        }
      />
    </Screen>
  );
}
