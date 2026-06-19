import { useState } from 'react';
import { Alert, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blockKeys, listBlocked, unblockUser } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { BlockedRow } from '@/components/BlockedRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Blocked-profiles list screen (M9 §3.1). Keyset pagination (rule #9); neutral
 * palette — no cyan/glow (rule #4). Unblock requires a destructive Alert confirm
 * before firing the mutation; the touched row dims while in flight.
 */
export default function BlockedScreen() {
  const router = useRouter();
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
      <View className="flex-row items-center gap-3 px-5 pb-4 pt-14">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text className="text-[17px] font-semibold text-foreground">
          {t('block.list.title', locale)}
        </Text>
      </View>

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
          query.isLoading ? (
            <View className="items-center pt-24">
              <ActivityIndicator color={semantic.faint} />
            </View>
          ) : (
            <View className="items-center px-8 pt-24">
              <EmptyState>{t('block.list.empty', locale)}</EmptyState>
            </View>
          )
        }
      />

      {/* Inline toast — no global host (rule: no global Sheet/Overlay/Toast) */}
      {toast ? (
        <View className="absolute inset-x-5 bottom-10 items-center rounded-card border border-hair bg-raise-2 px-5 py-3">
          <Text className="text-sm text-foreground">{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}
