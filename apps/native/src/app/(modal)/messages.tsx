import { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import { type Router, useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ConversationCursor,
  conversationKeys,
  getConversationsPage,
  subscribeConversations,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { ConversationRow } from '@/components/chat/ConversationRow';
import { useAuth } from '@/lib/auth-context';
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
  const [toast, setToast] = useState(false);

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
      <View className="flex-row items-center justify-between px-5 pb-3 pt-14">
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
          <Text className="text-2xl text-faint">‹</Text>
        </Pressable>
        <Text className="text-[17px] font-semibold text-foreground">
          {t('messages.title', locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('messages.new', locale)}
          hitSlop={8}
          onPress={() => {
            // No person-picker yet (search/connections land later) — honest stub toast.
            setToast(true);
            setTimeout(() => setToast(false), 1600);
          }}
        >
          <Text className="text-2xl text-foreground">+</Text>
        </Pressable>
      </View>

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
              // `(modal)/chat` is registered but TypeScript typed routes don't resolve
              // query-string hrefs for future routes; use the same cast pattern as momenti.tsx.
              router.push({
                pathname: '/(modal)/chat',
                params: { conversationId: item.id },
              } as unknown as Parameters<Router['push']>[0]);
            }}
          />
        )}
        ListEmptyComponent={
          !query.isLoading ? (
            <View className="items-center px-8 pt-24">
              <EmptyState>{t('messages.empty.title', locale)}</EmptyState>
              <Text className="mt-1 text-center text-[13px] text-faint">
                {t('messages.empty.body', locale)}
              </Text>
            </View>
          ) : null
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
      />

      {toast ? (
        <View className="absolute bottom-16 self-center rounded-full border border-hair bg-raise-2 px-5 py-2">
          <Text className="text-[14px] font-semibold text-foreground">
            {t('messages.new.toast', locale)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
