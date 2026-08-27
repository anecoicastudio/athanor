import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, type FlatList as RNFlatList } from 'react-native';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockKeys,
  blockUser,
  conversationKeys,
  getConversation,
  getMessagesPage,
  type MessageCursor,
  messageKeys,
  sendMessage,
  subscribeMessages,
} from '@athanor/api';
import { dayBucket, memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Message } from '@athanor/schemas';
import { FlatList, Pressable, Text, View } from '@/tw';
import { Input } from '@/components/Input';
import { HIT_SLOP } from '@/lib/a11y';
import { Avatar } from '@/components/Avatar';
import { Bubble } from '@/components/chat/Bubble';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { AURA_UNKNOWN, auraDisplayValue } from '@/lib/aura-display';
import { isRunEnd } from '@/lib/chat-runs';
import { MediaSheet } from '@/components/media/MediaSheet';
import type { PickedMedia } from '@/lib/media/pick';
import { chatMediaPath, newMediaId, processAndUpload } from '@/lib/media/upload';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { useAuth } from '@/lib/auth-context';
import { useAuraScore } from '@/hooks/use-aura-score';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/ToastHost';

type Row =
  | { type: 'marker'; key: string; label: string }
  | { type: 'msg'; key: string; message: Message };

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { session } = useAuth();
  const locale = useLocale();
  const myId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<RNFlatList<Row>>(null);
  // Whether the viewport is pinned to the newest message — gates auto-scroll so loading
  // older history (scroll-up pagination) doesn't yank the reader back to the bottom.
  const atBottomRef = useRef(true);
  const [draft, setDraft] = useState('');
  // The staged image, one per message (#155). `mediaId` is minted at PICK time, not at send:
  // a failed send retried from the same staging re-uploads to the SAME key (upsert), instead
  // of orphaning an object per attempt.
  const [attachment, setAttachment] = useState<{ media: PickedMedia; mediaId: string } | null>(
    null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const { showToast } = useToast();

  const headerQuery = useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: () => getConversation(supabase, conversationId),
    enabled: Boolean(conversationId),
  });
  const peer = headerQuery.data;

  // Peer Aura for the header (read-only).
  const peerId = peer?.peerId;
  const peerAuraQuery = useAuraScore(peerId);
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

  // One signing call for every image in the loaded thread (#155) — the PostMedia pattern:
  // bubbles receive resolved URLs, never the client.
  const mediaPaths = useMemo(
    () => chrono.map((m) => m.media_url).filter((p): p is string => Boolean(p)),
    [chrono],
  );
  const { urls: mediaUrls, isLoading: mediaUrlsLoading } = useSignedUrls('chat-media', mediaPaths);

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
    // Upload-first, insert-second (#155): the client holds no UPDATE grant on messages, so
    // there is no attach-after-insert — the row must already carry the storage key.
    mutationFn: async (input: {
      body?: string;
      staged: { media: PickedMedia; mediaId: string } | null;
    }) => {
      const senderId = myId as string;
      if (input.staged) {
        const path = chatMediaPath(senderId, conversationId, input.staged.mediaId);
        await processAndUpload(input.staged.media, { bucket: 'chat-media', path });
        return sendMessage(supabase, {
          conversationId,
          senderId,
          ...(input.body ? { body: input.body } : {}),
          mediaUrl: path,
        });
      }
      return sendMessage(supabase, { conversationId, senderId, body: input.body });
    },
    onSuccess: async () => {
      setDraft('');
      setAttachment(null);
      await queryClient.invalidateQueries({ queryKey: messageKeys.thread(conversationId) });
      await queryClient.invalidateQueries({ queryKey: conversationKeys.list() });
    },
    // A failed send is transient and the draft survives it — attachment included, so the retry
    // the copy offers is the composer still sitting there — a modal over the thread would only
    // hide it (#102). A retry re-uploads to the same key (see `attachment`), never a new orphan.
    onError: () => showToast(t('chat.failed', locale)),
  });

  const trimmed = draft.trim();
  const canSend =
    (trimmed.length > 0 || attachment !== null) && !send.isPending && Boolean(conversationId);

  // Unreachable by construction — the sheet below offers photo + library stills only (no
  // `allowVideo`/`allowAudio`) — but spelled out like `useMomentUpload`'s guard: under a
  // widened union a video would otherwise be staged, uploaded, and refused by the bucket's
  // image-only mime list after the bytes already travelled.
  const onPickMedia = (m: PickedMedia) => {
    if (m.kind !== 'image') {
      showToast(t('media.failed', locale));
      return;
    }
    setAttachment({ media: m, mediaId: newMediaId() });
  };

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
                mediaUrl={item.message.media_url ? mediaUrls[item.message.media_url] : undefined}
                mediaLoading={mediaUrlsLoading}
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
        <View className="border-t border-hair bg-background">
          {/* staged image (#155) — post-compose's tile idiom: dim while sending, ✕ otherwise. */}
          {attachment ? (
            <View className="flex-row items-center gap-3 px-4 pt-3">
              <View className="relative">
                {/* Kind branch BEFORE the drawing surface (#318/#154 guard): `onPickMedia`
                  stages stills only, so the frameless arm is unreachable today — but under a
                  widened sheet it is the no-poster fill, never an <Image> over a file with no
                  frame to find. */}
                {attachment.media.kind === 'video' || attachment.media.kind === 'audio' ? (
                  <View
                    className="h-16 w-16 items-center justify-center rounded-[8px] bg-raise-2"
                    accessible
                    accessibilityLabel={t(
                      attachment.media.kind === 'audio'
                        ? 'media.noPoster.audio'
                        : 'media.noPoster.video',
                      locale,
                    )}
                  >
                    <Text
                      className="text-2xl text-faint"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      ▶
                    </Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: attachment.media.uri }}
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                )}
                {send.isPending ? (
                  <View
                    className="absolute inset-0 items-center justify-center rounded-[8px] bg-surface-muted"
                    style={{ opacity: 0.6 }}
                  />
                ) : (
                  <Pressable
                    className="absolute right-[-6px] top-[-6px] h-5 w-5 items-center justify-center rounded-full bg-raise"
                    onPress={() => setAttachment(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat.a11y.removeAttachment', locale)}
                    hitSlop={8}
                  >
                    <Text className="text-[11px] text-faint">✕</Text>
                  </Pressable>
                )}
              </View>
              {send.isPending ? (
                <Text className="text-[13px] text-faint">
                  {t('media.uploadingIndeterminate', locale)}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View className="flex-row items-end gap-2 px-4 py-3">
            {/* attach — flat and faint (rule #4: attaching isn't a moment). One image per
              message; while one is staged the door closes rather than silently replacing it. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.a11y.attach', locale)}
              hitSlop={HIT_SLOP}
              disabled={send.isPending || attachment !== null}
              onPress={() => setSheetOpen(true)}
              className={`h-11 w-11 items-center justify-center ${
                send.isPending || attachment !== null ? 'opacity-40' : ''
              }`}
            >
              <Text className="text-[22px] text-faint">+</Text>
            </Pressable>
            <Input
              className="flex-1"
              size="sm"
              placeholder={t('chat.input.placeholder', locale)}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.a11y.send', locale)}
              disabled={!canSend}
              onPress={() =>
                send.mutate({ body: trimmed.length > 0 ? trimmed : undefined, staged: attachment })
              }
              className={`h-11 w-11 items-center justify-center rounded-full bg-aura ${
                canSend ? '' : 'opacity-40'
              }`}
            >
              <Text className="text-[20px] text-on-aura">›</Text>
            </Pressable>
          </View>
        </View>

        {/* Kept mounted (visible={false}), never conditionally rendered: the iOS
          close-then-launch dance queues the picker on this Modal's onDismiss. */}
        <MediaSheet
          visible={sheetOpen}
          locale={locale}
          onPick={onPickMedia}
          onClose={() => setSheetOpen(false)}
          onError={(key) => showToast(t(key, locale))}
        />
      </Screen>
    </KeyboardAvoiding>
  );
}
