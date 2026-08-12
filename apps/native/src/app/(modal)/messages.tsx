import { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ConversationCursor,
  conversationKeys,
  getConversationsPage,
  subscribeConversations,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { ConversationRow } from '@/components/chat/ConversationRow';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';

export default function MessagesScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = Date.now();

  // In-session unread: ids that arrived via realtime while the list was open (#3 — pip, no badge).
  // Persistent read-state (conversation_reads) is deferred to a later slice.
  const [unread, setUnread] = useState<Set<string>>(new Set());

  const query = useInfiniteQuery({
    queryKey: conversationKeys.list(),
    queryFn: ({ pageParam }) =>
      getConversationsPage(supabase, { cursor: pageParam as ConversationCursor | null }),
    initialPageParam: null as ConversationCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    const unsubscribe = subscribeConversations(supabase, () => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
    });
    return unsubscribe;
  }, [queryClient]);

  return (
    <View className="flex-1 bg-background">
      <ModalHeader
        title={t('messages.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <View className="flex-row items-center gap-5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('connection.a11y.hub', locale)}
              hitSlop={8}
              onPress={() => router.push('/connections')}
            >
              <Text className="text-2xl text-faint">◎</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('messages.new', locale)}
              hitSlop={8}
              onPress={() => router.push('/new-message')}
            >
              <Text className="text-2xl text-foreground">+</Text>
            </Pressable>
          </View>
        }
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-5 pb-10"
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            locale={locale}
            now={now}
            unread={unread.has(item.id)}
            onPress={() => {
              setUnread((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
              router.push(`/chat?conversationId=${item.id}`);
            }}
          />
        )}
        ListEmptyComponent={
          <ListState
            state={listState({
              status: query.status,
              fetchStatus: query.fetchStatus,
              isEmpty: items.length === 0,
              staleWins: true,
            })}
            locale={locale}
            errorLabel={t('messages.error', locale)}
            emptyLabel={t('messages.empty.title', locale)}
            emptyBody={t('messages.empty.body', locale)}
            onRetry={() => void query.refetch()}
            loading={null}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
      />
    </View>
  );
}
