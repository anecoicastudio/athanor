import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  auraKeys,
  blockKeys,
  blockUser,
  conversationKeys,
  getAuraScore,
  getConversation,
  getMessagesPage,
  type MessageCursor,
  messageKeys,
  sendMessage,
  subscribeMessages,
} from '@athanor/api';
import { dayBucket } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { Pressable, Text, TextInput, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Bubble } from '@/components/chat/Bubble';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type Row =
  | { type: 'marker'; key: string; label: string }
  | { type: 'msg'; key: string; message: Message };

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { profile, session } = useAuth();
  const locale = profile?.locale ?? 'it';
  const myId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<Row>>(null);
  // Whether the viewport is pinned to the newest message — gates auto-scroll so loading
  // older history (scroll-up pagination) doesn't yank the reader back to the bottom.
  const atBottomRef = useRef(true);
  const [draft, setDraft] = useState('');

  const headerQuery = useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: () => getConversation(supabase, conversationId),
    enabled: Boolean(conversationId),
  });
  const peer = headerQuery.data;

  // Peer Aura for the header (read-only; coalesces to zero until the engine is live).
  const peerId = peer?.peerId;
  const peerAuraQuery = useQuery({
    queryKey: auraKeys.score(peerId ?? ''),
    queryFn: () => getAuraScore(supabase, peerId as string),
    enabled: Boolean(peerId),
  });
  const peerScore = peerAuraQuery.data?.score ?? 0;

  const messagesQuery = useInfiniteQuery({
    queryKey: messageKeys.thread(conversationId),
    queryFn: ({ pageParam }) =>
      getMessagesPage(supabase, { conversationId, cursor: pageParam as MessageCursor | null }),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(conversationId),
  });

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = subscribeMessages(supabase, conversationId, () => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.thread(conversationId) });
    });
    return unsubscribe;
  }, [conversationId, queryClient]);

  // pages are newest-first; flatten then reverse into chronological order.
  const chrono = useMemo(() => {
    const desc = messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [];
    return [...desc].reverse();
  }, [messagesQuery.data]);

  // inject day-markers when the calendar day changes (dayBucket from core, clock injected).
  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const out: Row[] = [];
    let lastDay = '';
    for (const m of chrono) {
      const b = dayBucket(m.created_at, now);
      const dayId = b.kind === 'date' ? b.iso.slice(0, 10) : b.kind;
      if (dayId !== lastDay) {
        const label =
          b.kind === 'today'
            ? t('chat.day.today', locale)
            : b.kind === 'yesterday'
              ? t('chat.day.yesterday', locale)
              : new Date(b.iso).toLocaleDateString(locale);
        out.push({ type: 'marker', key: `m-${dayId}`, label });
        lastDay = dayId;
      }
      out.push({ type: 'msg', key: m.id, message: m });
    }
    return out;
  }, [chrono, locale]);

  const send = useMutation({
    mutationFn: (body: string) =>
      sendMessage(supabase, { conversationId, senderId: myId as string, body }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: messageKeys.thread(conversationId) });
      await queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
    },
    onError: () => Alert.alert(t('chat.failed', locale)),
  });

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !send.isPending && Boolean(conversationId);

  const openMenu = () =>
    Alert.alert(t('chat.a11y.menu', locale), undefined, [
      {
        text: t('chat.block', locale),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('block.confirm', locale, { name: peer?.peerHandle ?? '' }), undefined, [
            { text: t('common.cancel', locale), style: 'cancel' },
            {
              text: t('block.cta', locale),
              style: 'destructive',
              onPress: () => {
                if (!peer?.peerId) return;
                return blockUser(supabase, peer.peerId).then(() => {
                  void queryClient.invalidateQueries({ queryKey: blockKeys.all });
                  router.back();
                });
              },
            },
          ]),
      },
      {
        text: t('chat.report', locale),
        onPress: () => {
          if (!peer?.peerId) return;
          router.push({
            pathname: '/(modal)/report',
            params: {
              targetType: 'person',
              targetId: peer.peerId,
              peerName: peer.peerHandle ?? '',
            },
          });
        },
      },
      { text: t('common.cancel', locale), style: 'cancel' },
    ]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* header */}
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-14">
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
          <Text className="text-2xl text-faint">‹</Text>
        </Pressable>
        <Avatar handle={peer?.peerHandle ?? null} size={36} />
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-foreground">
            {peer?.peerHandle ? `@${peer.peerHandle}` : '—'}
          </Text>
          <Text className="text-[11px] text-faint">
            {t('chat.peerAura', locale, { score: peerScore })}
          </Text>
        </View>
        {peer?.peerId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.a11y.profile', locale)}
            hitSlop={8}
            onPress={() => router.push(`/user/${peer.peerId}`)}
          >
            <Text className="text-xl text-faint">↗</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.a11y.menu', locale)}
          hitSlop={8}
          onPress={openMenu}
        >
          <Text className="text-xl text-faint">⋯</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerClassName="px-4 py-3"
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={() => {
          // Auto-scroll to the newest message only when the reader is already at the bottom;
          // prepending older history (scroll-up pagination) must not bounce them down.
          if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        renderItem={({ item }) =>
          item.type === 'marker' ? (
            <View className="my-3 items-center">
              <Text className="text-[11px] uppercase tracking-wider text-faint">{item.label}</Text>
            </View>
          ) : (
            <Bubble message={item.message} myId={myId as string} locale={locale} />
          )
        }
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottomRef.current =
            contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
          if (
            contentOffset.y < 80 &&
            messagesQuery.hasNextPage &&
            !messagesQuery.isFetchingNextPage
          ) {
            void messagesQuery.fetchNextPage();
          }
        }}
        scrollEventThrottle={64}
      />

      {/* chat bar — send is a FLAT cyan surface (rule #4: cyan is allowed on the send button,
          but the glow is reserved for moment-grade events; a routine send is not one). */}
      <View className="flex-row items-end gap-2 border-t border-hair bg-background px-4 py-3">
        <TextInput
          className="flex-1 rounded-2xl border border-hair bg-raise px-4 py-2 text-[15px] text-foreground"
          placeholder={t('chat.input.placeholder', locale)}
          placeholderTextColor={semantic.faint}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.a11y.send', locale)}
          disabled={!canSend}
          onPress={() => send.mutate(trimmed)}
          className={`h-11 w-11 items-center justify-center rounded-full bg-aura ${
            canSend ? '' : 'opacity-40'
          }`}
        >
          <Text className="text-[20px] text-on-aura">›</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
