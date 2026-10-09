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
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import { FlatList, Pressable, View, cn } from '@/tw';
import { ListPageError } from '@/components/ListPageError';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { ConversationRow } from '@/components/chat/ConversationRow';
import { AddIcon, PeopleIcon } from '@/components/glyphs';
import { useNow } from '@/hooks/use-now';
import { useLocale } from '@/hooks/use-locale';
import { listState } from '@/lib/list-state';
import { devWarn } from '@/lib/log';
import { PRESS_DIM } from '@/lib/press';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

export default function MessagesScreen() {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = useNow();

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
        // Two drawn controls in 44pt boxes, 4 apart, the last on the gutter (DESIGN §6
        // «Interface icons»; #921): the member profile's header has the same pair of boxes.
        right={
          <View className="flex-row items-center gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('connection.a11y.hub', locale)}
              className={cn('min-h-[44px] min-w-[44px] items-center justify-center', PRESS_DIM)}
              onPress={() => router.push('/connections')}
            >
              <PeopleIcon color={galleria.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('messages.new', locale)}
              className={cn(
                '-mr-3 min-h-[44px] min-w-[44px] items-center justify-center',
                PRESS_DIM,
              )}
              onPress={() => router.push('/new-message')}
            >
              <AddIcon color={galleria.foreground} />
            </Pressable>
          </View>
        }
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerClassName="grow px-5 pb-12"
        renderItem={({ item, index }) => (
          <ConversationRow
            item={item}
            locale={locale}
            now={now}
            unread={item.unread}
            onPress={() => openConversation(item.id)}
            // The row draws its own segment of one group (#921): tell it where it stands.
            first={index === 0}
            last={index === items.length - 1}
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
        ListFooterComponent={
          <ListPageError
            query={query}
            hasRows={items.length > 0}
            label={t('messages.error', locale)}
            retryLabel={t('common.retry', locale)}
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
