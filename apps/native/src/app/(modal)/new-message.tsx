import { useState } from 'react';
import { FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  type ConnectionCursor,
  connectionKeys,
  getConnectionsPage,
  getOrCreateConversation,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Text, TextInput, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { ConnectionRow } from '@/components/connections/ConnectionRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * New-message person picker (P3.2): the Messages «+» target. Searchable
 * connections list (same query key as the Connessioni hub — shared cache);
 * picking a person opens-or-creates the 1:1 DM and replaces this transient
 * picker with the chat. DMs are connections-only by design (M5).
 */
export default function NewMessageScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

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

  const pick = async (peerId: string) => {
    if (creatingId) return;
    setCreatingId(peerId);
    try {
      const conversationId = await getOrCreateConversation(supabase, peerId);
      router.replace(`/chat?conversationId=${conversationId}`);
    } catch {
      setToast(true);
      setTimeout(() => setToast(false), 1600);
      setCreatingId(null);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ModalHeader title={t('messages.new', locale)} backLabel={t('common.back', locale)} />

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
          <ConnectionRow item={item} locale={locale} onPress={() => void pick(item.peerId)} />
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
      {toast ? <Toast label={t('chat.openFailed', locale)} /> : null}
    </View>
  );
}
