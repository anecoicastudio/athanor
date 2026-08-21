import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, type FlatList as RNFlatList } from 'react-native';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
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
import { dayBucket, memberLabel } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { FlatList, Pressable, Text, TextInput, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Avatar } from '@/components/Avatar';
import { Bubble } from '@/components/chat/Bubble';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { AURA_UNKNOWN, auraDisplayValue } from '@/lib/aura-display';
import { isRunEnd } from '@/lib/chat-runs';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/ToastHost';

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
  const listRef = useRef<RNFlatList<Row>>(null);
  // Whether the viewport is pinned to the newest message — gates auto-scroll so loading
  // older history (scroll-up pagination) doesn't yank the reader back to the bottom.
  const atBottomRef = useRef(true);
  const [draft, setDraft] = useState('');
  const { showToast } = useToast();

  const headerQuery = useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: () => getConversation(supabase, conversationId),
    enabled: Boolean(conversationId),
  });
  const peer = headerQuery.data;

  // Peer Aura for the header (read-only).
  const peerId = peer?.peerId;
  const peerAuraQuery = useQuery({
    queryKey: auraKeys.score(peerId ?? ''),
    queryFn: () => getAuraScore(supabase, peerId as string),
    enabled: Boolean(peerId),
  });
  // `--` rather than 0 on a failed read: the header chip sits next to the person's handle, so
  // a coalesced zero reads as a claim about them rather than about our request.
  const peerScore = auraDisplayValue(peerAuraQuery.data?.score, peerAuraQuery.isError);

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

  // One object rather than three props threaded through every bubble; memoised so a re-render
  // of the thread does not hand `<Bubble>` a new identity object on every keystroke.
  const peerIdentity = useMemo(
    () =>
      peer
        ? {
            handle: peer.peerHandle,
            displayName: peer.peerDisplayName,
            avatarPath: peer.peerAvatarPath,
          }
        : null,
    [peer],
  );

  const send = useMutation({
    mutationFn: (body: string) =>
      sendMessage(supabase, { conversationId, senderId: myId as string, body }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: messageKeys.thread(conversationId) });
      await queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
    },
    // A failed send is transient and the draft survives it, so the retry the copy offers is
    // the composer still sitting there — a modal over the thread would only hide it (#102).
    onError: () => showToast(t('chat.failed', locale)),
  });

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !send.isPending && Boolean(conversationId);

  const peerName = memberLabel(peer?.peerDisplayName, peer?.peerHandle) ?? '—';
  // The identity pressable masks its children for screen readers, so its label re-carries
  // name + Aura; «Vedi il profilo» rides along as the hint (the action, not the content).
  const peerAuraA11y =
    peerScore === AURA_UNKNOWN
      ? t('aura.unknown', locale)
      : t('chat.peerAura', locale, { score: peerScore });

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
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader
          backLabel={t('common.back', locale)}
          avatar={
            <Avatar
              handle={peer?.peerHandle ?? null}
              displayName={peer?.peerDisplayName ?? null}
              avatarPath={peer?.peerAvatarPath ?? null}
              size={36}
            />
          }
          title={peerName}
          subtitle={
            <Text className="text-[11px] text-faint" accessibilityLabel={peerAuraA11y}>
              {t('chat.peerAura', locale, { score: peerScore })}
            </Text>
          }
          // The identity block IS the link (#356) — the old ↗ beside it is dropped, so
          // VoiceOver never announces two identical «Vedi il profilo» targets.
          onIdentityPress={
            peer?.peerId ? () => router.push(`/(modal)/user/${peer.peerId}`) : undefined
          }
          identityLabel={`${peerName}, ${peerAuraA11y}`}
          identityHint={t('chat.a11y.profile', locale)}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.a11y.menu', locale)}
              hitSlop={HIT_SLOP}
              onPress={openMenu}
            >
              <Text className="text-xl text-faint">⋯</Text>
            </Pressable>
          }
        />

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
          renderItem={({ item, index }) =>
            item.type === 'marker' ? (
              <View className="my-3 items-center">
                <SectionLabel>{item.label}</SectionLabel>
              </View>
            ) : (
              <Bubble
                message={item.message}
                myId={myId as string}
                locale={locale}
                peer={peerIdentity}
                // The face sits on the LAST bubble of a run, beside the row it is bottom-aligned
                // to. A run ends when the next row is a day marker, the end of the thread, or a
                // message from anyone else.
                showPeerAvatar={isRunEnd(rows, index)}
              />
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
            className="flex-1 rounded-full border border-hair bg-raise px-4 py-2 text-[15px] text-foreground"
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
      </Screen>
    </KeyboardAvoiding>
  );
}
