import { useEffect, useState } from 'react';
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
import { t } from '@athanor/i18n';
import type { ConnectionRequestListItem } from '@athanor/schemas';
import { FlatList, View } from '@/tw';
import { Input } from '@/components/Input';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { ConnectionRequestRow } from '@/components/connections/ConnectionRequestRow';
import { ConnectionRow } from '@/components/connections/ConnectionRow';
import { SegmentedToggle } from '@/components/connections/SegmentedToggle';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

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
    <Screen>
      <ModalHeader title={t('connection.hub.title', locale)} backLabel={t('common.back', locale)} />

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
            <ListState
              state={listState({
                status: requestsQuery.status,
                fetchStatus: requestsQuery.fetchStatus,
                isEmpty: requests.length === 0,
                staleWins: true,
              })}
              locale={locale}
              errorLabel={t('connection.inbox.error', locale)}
              emptyLabel={t('connection.inbox.empty', locale)}
              emptyBody={t('connection.inbox.emptyBody', locale)}
              onRetry={() => void requestsQuery.refetch()}
              loading={null}
            />
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
            <Input
              placeholder={t('connection.list.search', locale)}
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
                onPress={() => router.push(`/(modal)/user/${item.peerId}`)}
              />
            )}
            ListEmptyComponent={
              // A search that matched nothing and a search that FAILED were the same branch,
              // and the failure got the reassuring copy. The error arm now outranks both, so
              // «Nessuna corrispondenza» is only ever said about a read that came back.
              <ListState
                state={listState({
                  status: connectionsQuery.status,
                  fetchStatus: connectionsQuery.fetchStatus,
                  isEmpty: connections.length === 0,
                  staleWins: true,
                })}
                locale={locale}
                errorLabel={t('connection.list.error', locale)}
                emptyLabel={
                  search.trim()
                    ? t('connection.list.noMatch', locale)
                    : t('connection.list.empty', locale)
                }
                emptyBody={search.trim() ? undefined : t('connection.list.emptyBody', locale)}
                onRetry={() => void connectionsQuery.refetch()}
                loading={null}
              />
            }
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (connectionsQuery.hasNextPage && !connectionsQuery.isFetchingNextPage)
                void connectionsQuery.fetchNextPage();
            }}
          />
        </View>
      )}
    </Screen>
  );
}
