import { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ConnectionCursor,
  connectionKeys,
  conversationKeys,
  getConnectionsPage,
  getIncomingRequestsPage,
  type RequestCursor,
  respondToConnection,
  subscribeIncomingConnections,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { ConnectionRequestListItem } from '@athanor/schemas';
import { Pressable, Text, TextInput, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { ConnectionRequestRow } from '@/components/connections/ConnectionRequestRow';
import { ConnectionRow } from '@/components/connections/ConnectionRow';
import { SegmentedToggle } from '@/components/connections/SegmentedToggle';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type Segment = 'requests' | 'connections';

/**
 * Connessioni hub (M5): the Richieste inbox (accept/decline incoming requests, live via
 * realtime) and the searchable Connessioni list. Keyset pagination only (rule #9); flat
 * cyan accent on the active segment, no glow (rule #4); all copy via i18n (rule #5).
 */
export default function ConnectionsScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();
  const queryClient = useQueryClient();

  const [segment, setSegment] = useState<Segment>('requests');
  const [search, setSearch] = useState('');

  // ── Richieste (incoming) ──────────────────────────────────────────────────
  const requestsQuery = useInfiniteQuery({
    queryKey: connectionKeys.incoming(),
    queryFn: ({ pageParam }) =>
      getIncomingRequestsPage(supabase, { cursor: pageParam as RequestCursor | null }),
    initialPageParam: null as RequestCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const requests = requestsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  // Live inbox: invalidate on any change to the caller's requests (RLS-scoped stream).
  useEffect(() => {
    const unsubscribe = subscribeIncomingConnections(supabase, () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.incoming() });
    });
    return unsubscribe;
  }, [queryClient]);

  const [respondingId, setRespondingId] = useState<string | null>(null);
  const respondMutation = useMutation({
    mutationFn: ({ accept, item }: { accept: boolean; item: ConnectionRequestListItem }) =>
      respondToConnection(supabase, item.id, accept),
    onMutate: ({ item }) => setRespondingId(item.id),
    onSuccess: (_data, { accept }) => {
      // refresh the whole connections tree — inbox + the Connessioni list + per-peer status
      // (an accepted request must appear in the list, not just leave the inbox).
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      // an accept created a 1:1 chat — refresh the conversations list too.
      if (accept) void queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: connectionKeys.incoming() });
    },
    onSettled: () => setRespondingId(null),
  });

  // ── Connessioni (search) ──────────────────────────────────────────────────
  const connectionsQuery = useInfiniteQuery({
    queryKey: connectionKeys.list(search),
    queryFn: ({ pageParam }) =>
      getConnectionsPage(supabase, {
        search,
        cursor: pageParam as ConnectionCursor | null,
      }),
    initialPageParam: null as ConnectionCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const connections = connectionsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pb-3 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-2xl text-faint">‹</Text>
        </Pressable>
        <Text className="text-[17px] font-semibold text-foreground">
          {t('connection.hub.title', locale)}
        </Text>
        <View className="w-6" />
      </View>

      <View className="px-5 pb-4">
        <SegmentedToggle
          value={segment}
          onChange={setSegment}
          labels={{
            requests: t('connection.tab.requests', locale),
            connections: t('connection.tab.connections', locale),
          }}
        />
      </View>

      {segment === 'requests' ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 pb-10"
          renderItem={({ item }) => (
            <ConnectionRequestRow
              item={item}
              locale={locale}
              pending={respondingId === item.id}
              onAccept={() => respondMutation.mutate({ accept: true, item })}
              onDecline={() => respondMutation.mutate({ accept: false, item })}
            />
          )}
          ListEmptyComponent={
            !requestsQuery.isLoading ? (
              <View className="items-center px-8 pt-24">
                <EmptyState>{t('connection.inbox.empty', locale)}</EmptyState>
                <Text className="mt-1 text-center text-[13px] text-faint">
                  {t('connection.inbox.emptyBody', locale)}
                </Text>
              </View>
            ) : null
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (requestsQuery.hasNextPage && !requestsQuery.isFetchingNextPage)
              void requestsQuery.fetchNextPage();
          }}
        />
      ) : (
        <View className="flex-1">
          <View className="px-5 pb-3">
            <TextInput
              className="rounded-full border border-hair bg-raise px-5 py-3 text-foreground"
              placeholder={t('connection.list.search', locale)}
              placeholderTextColor={semantic.faint}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <FlatList
            data={connections}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-5 pb-10"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <ConnectionRow
                item={item}
                locale={locale}
                onPress={() => router.push(`/user/${item.peerId}`)}
              />
            )}
            ListEmptyComponent={
              !connectionsQuery.isLoading ? (
                <View className="items-center px-8 pt-24">
                  {search.trim() ? (
                    <Text className="text-center text-faint">
                      {t('connection.list.noMatch', locale)}
                    </Text>
                  ) : (
                    <>
                      <EmptyState>{t('connection.list.empty', locale)}</EmptyState>
                      <Text className="mt-1 text-center text-[13px] text-faint">
                        {t('connection.list.emptyBody', locale)}
                      </Text>
                    </>
                  )}
                </View>
              ) : null
            }
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (connectionsQuery.hasNextPage && !connectionsQuery.isFetchingNextPage)
                void connectionsQuery.fetchNextPage();
            }}
          />
        </View>
      )}
    </View>
  );
}
