import { useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ConversationCursor,
  type ConversationListPage,
  conversationKeys,
  getConversationsPage,
  markConversationRead,
  subscribeConversations,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import { FlatList, Pressable, Text, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { ConversationRow } from '@/components/chat/ConversationRow';
import { useLocale } from '@/hooks/use-locale';
import { listState } from '@/lib/list-state';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

export default function MessagesScreen() {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = Date.now();

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

  /**
   * Opening a thread clears its pip (#637). The cache is edited first and the write follows,
   * because the pip has to go out under the finger — and because nothing would bring the answer
   * back on its own: the realtime channel watches `conversations`, not `conversation_reads`, and
   * RN wires no focusManager, so returning from the chat refetches nothing.
   *
   * `chat.tsx` marks the same cursor on mount, which is not redundant — it is the only marker on
   * the path that skips this screen entirely: a tapped push straight into a conversation.
   */
  const openConversation = useCallback(
    (id: string) => {
      queryClient.setQueryData<InfiniteData<ConversationListPage>>(
        conversationKeys.list(),
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((i) => (i.id === id ? { ...i, unread: false } : i)),
            })),
          },
      );
      markConversationRead(supabase, id).catch((e) => devWarn('[messages] markRead', e));
      router.push(`/chat?conversationId=${id}`);
    },
    [queryClient, router],
  );

  return (
    <Screen>
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
            unread={item.unread}
            onPress={() => openConversation(item.id)}
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
    </Screen>
  );
}
