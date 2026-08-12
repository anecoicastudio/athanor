import { useState } from 'react';
import { Alert } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blockKeys, listBlocked, unblockUser } from '@athanor/api';
import { t } from '@athanor/i18n';
import { FlatList, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { BlockedRow } from '@/components/trust/BlockedRow';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';

/**
 * Blocked-profiles list screen (M9 §3.1). Keyset pagination (rule #9); neutral
 * palette — no cyan/glow (rule #4). Unblock requires a destructive Alert confirm
 * before firing the mutation; the touched row dims while in flight.
 *
 * The empty branch goes through `listState` rather than `!isLoading` (#111). This is the
 * screen where that mattered most: «Non hai bloccato nessuno» rendered on a failed read is
 * a false all-clear, and someone checking whether they are still protected has no way to
 * tell it from the truth.
 */
export default function BlockedScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const qc = useQueryClient();
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ── Blocked list (keyset, created_at desc) ────────────────────────────────
  const query = useInfiniteQuery({
    queryKey: blockKeys.list(),
    queryFn: ({ pageParam }) => listBlocked(supabase, pageParam ?? undefined),
    initialPageParam: undefined as { createdAt: string; id: string } | undefined,
    getNextPageParam: (last) =>
      last.length === 0
        ? undefined
        : { createdAt: last[last.length - 1]!.createdAt, id: last[last.length - 1]!.id },
  });
  const rows = query.data?.pages.flat() ?? [];

  // ── Unblock mutation ──────────────────────────────────────────────────────
  const unblock = useMutation({
    mutationFn: (peerId: string) => unblockUser(supabase, peerId),
    onMutate: (peerId) => setMutatingId(peerId),
    onSettled: () => setMutatingId(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: blockKeys.all });
      showToast(t('block.toast.unblocked', locale));
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
    <View className="flex-1 bg-background">
      {/* Header */}
      <ModalHeader title={t('block.list.title', locale)} backLabel={t('common.back', locale)} />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-5 pb-10"
        renderItem={({ item }) => (
          <BlockedRow
            item={item}
            unblockLabel={t('block.unblock', locale)}
            mutating={mutatingId === item.peerId}
            onUnblock={() => confirmUnblock(item.peerId, item.peerHandle)}
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
      />

      {/* Inline toast — no global host (rule: no global Sheet/Overlay/Toast) */}
      {toast ? <Toast label={toast} /> : null}
    </View>
  );
}
