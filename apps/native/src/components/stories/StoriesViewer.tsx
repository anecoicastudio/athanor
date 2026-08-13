import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  StyleSheet,
  type View as RNView,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import type { Locale, StorySegment } from '@athanor/schemas';
import { Pressable, SafeAreaView, Text, TextInput, View } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';
import { Toast } from '@/components/Toast';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { star } from '@/lib/star';

const PHOTO_MS = 5000;
const DEFAULT_VIDEO_MS = 15000;
const REPLY_TOAST_MS = 2500;

function segmentMs(seg: StorySegment): number {
  if (seg.kind === 'video') return (seg.duration_s ?? DEFAULT_VIDEO_MS / 1000) * 1000;
  return PHOTO_MS;
}

/**
 * Plays one person's story (frontend §3.4). Segments auto-advance (photo 5s, video by duration);
 * tap right two-thirds → next, left third → prev, hold → pause, swipe down → close, swipe
 * horizontally → jump person (#298). `isOwn` swaps the action set. `count` (author-only
 * celebration total) renders only when `isOwn`. All counts are owner-only (rule #3); the ✦
 * react is viewer-state only.
 *
 * Person chaining (#298) lives in the HOST: this component knows one person's segments and
 * reports the edges — `onAdvanceEnd` (finished past the last segment), `onAdvanceStart`
 * (tap-left on the first), `onJumpNext`/`onJumpPrev` (horizontal swipe). `startAt` says which
 * end to open on when the segments identity changes ('last' when arriving backwards).
 *
 * Layout (#297): the media fills the screen (`absolute inset-0`, cover) and all chrome floats
 * above it in two `bg-background/70` scrim bands — DESIGN.md §6 "Full-bleed media + overlay
 * chrome". Each band owns its safe-area edge via the per-view `SafeAreaView` (#161: the
 * `useSafeAreaInsets` hook is per-window and over-insets inside the iOS `(modal)` sheet).
 *
 * The reply composer is real (#297): sending goes through `onSendReply` in the background — the
 * viewer is never left. Focus pauses the segment, blur resumes it.
 *
 * Gestures stay on PanResponder: SwipeDeck's docblock claims reanimated/gesture-handler crash
 * unimported; static evidence says the claim is stale, but it is unverified on device either
 * way (#298), and this gesture needs nothing PanResponder lacks.
 */
export function StoriesViewer({
  segments,
  urls,
  urlsLoading,
  name,
  isOwn,
  viewerReacted,
  count,
  locale,
  onClose,
  onAdvanceEnd,
  onAdvanceStart,
  onJumpNext,
  onJumpPrev,
  startAt = 'first',
  onReact,
  onSendReply,
  onMakeDream,
  onAddMoment,
  onPin,
  onDelete,
}: {
  segments: StorySegment[];
  urls: Record<string, string>;
  /** `useSignedUrls().isLoading` — without it a signing round-trip looks like lost media. */
  urlsLoading: boolean;
  name: string;
  isOwn: boolean;
  viewerReacted: boolean;
  count: number;
  locale: Locale;
  onClose: () => void;
  /** Advanced past the last segment — the person's story FINISHED. */
  onAdvanceEnd: () => void;
  /** Tapped left on the first segment — the host may step to the previous person (#298). */
  onAdvanceStart: () => void;
  /** Horizontal swipe — person jump without finishing (#298). */
  onJumpNext: () => void;
  onJumpPrev: () => void;
  /** Which end to open on when `segments` changes person ('last' when arriving backwards). */
  startAt?: 'first' | 'last';
  onReact: (segment: StorySegment) => void;
  /** Sends the reply into the DM without leaving the viewer; rejects on failure. */
  onSendReply: (body: string) => Promise<void>;
  onMakeDream: () => void;
  onAddMoment: () => void;
  onPin: (segment: StorySegment) => void;
  onDelete: (segment: StorySegment) => void;
}) {
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  // Tap-zone width from onLayout, not Dimensions-at-module-scope: that snapshot goes stale
  // after a rotation or in split view (#297 beyond-the-issue).
  const [zoneW, setZoneW] = useState(0);
  // How far this screen sits below the window top (the iOS `(modal)` pageSheet gap) — the
  // keyboardVerticalOffset #163 documents, measured rather than guessed.
  const [kbOffset, setKbOffset] = useState(0);
  const rootRef = useRef<RNView>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyToast, setReplyToast] = useState<'sent' | 'failed' | null>(null);
  const reduce = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const current = segments[si];
  const currentUrl = current ? urls[current.storage_path] : undefined;

  useEffect(() => {
    // A new segments identity is a person change (#298): open at the end `startAt` names.
    // `startAt` is deliberately not a dependency — it only means something with new segments.
    setSi(startAt === 'last' ? Math.max(0, segments.length - 1) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  useEffect(() => {
    if (!replyToast) return;
    const id = setTimeout(() => setReplyToast(null), REPLY_TOAST_MS);
    return () => clearTimeout(id);
  }, [replyToast]);

  const goNext = () => {
    if (si + 1 < segments.length) setSi(si + 1);
    else onAdvanceEnd();
  };
  const goPrev = () => {
    if (si > 0) setSi(si - 1);
    else onAdvanceStart();
  };

  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    if (paused) return;
    if (reduce) {
      progress.setValue(1); // no auto-advance under reduced motion — manual tap only
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: segmentMs(current),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) goNext();
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [si, paused, current?.id, reduce]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8 || Math.abs(g.dx) > 8,
        onPanResponderGrant: () => setPaused(true),
        onPanResponderRelease: (e, g) => {
          setPaused(false);
          if (g.dy > 100) {
            onClose();
            return;
          }
          // Horizontal swipe = person jump (#298), in either direction.
          if (Math.abs(g.dx) > 60 && Math.abs(g.dx) > Math.abs(g.dy)) {
            if (g.dx < 0) onJumpNext();
            else onJumpPrev();
            return;
          }
          if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10 && zoneW > 0) {
            if (e.nativeEvent.locationX < zoneW / 3) goPrev();
            else goNext();
          }
        },
        onPanResponderTerminate: () => setPaused(false),
      }),
    // Host callbacks are in the deps so the responder never fires a stale author cursor (#298).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [si, segments.length, zoneW, onClose, onAdvanceEnd, onAdvanceStart, onJumpNext, onJumpPrev],
  );

  const trimmed = reply.trim();
  const canSend = trimmed.length > 0 && !sending;
  const sendReply = async () => {
    if (!canSend) return;
    setSending(true);
    Keyboard.dismiss(); // blur resumes the segment
    try {
      await onSendReply(trimmed);
      setReply('');
      setReplyToast('sent');
    } catch {
      setReplyToast('failed');
    } finally {
      setSending(false);
    }
  };

  if (!current) return null;

  return (
    <View
      ref={rootRef}
      onLayout={() => {
        rootRef.current?.measureInWindow((_x, y) => setKbOffset(Math.max(0, y)));
      }}
      className="flex-1 bg-background"
    >
      {current.kind === 'video' ? (
        <MediaFrame
          kind="video"
          url={currentUrl}
          isLoading={urlsLoading}
          locale={locale}
          className="absolute inset-0"
        >
          {(uri) => <ViewerVideo key={current.id} uri={uri} paused={paused} />}
        </MediaFrame>
      ) : (
        <MediaFrame
          kind="photo"
          url={currentUrl}
          isLoading={urlsLoading}
          locale={locale}
          className="absolute inset-0"
        />
      )}

      <KeyboardAvoidingView
        style={styles.chrome}
        // `height`, not `undefined`: an undefined behavior leaves the component inert on
        // Android (#163). The chrome is an absolute overlay, so it cannot take the shared
        // KeyboardAvoiding wrapper's flex-column shape — same recipe, local copy.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={kbOffset}
      >
        <SafeAreaView edges={['top']} className="bg-background/70">
          <View className="flex-row gap-1 px-3 pt-3">
            {segments.map((seg, i) => (
              <View key={seg.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-hair">
                <Animated.View
                  style={{
                    height: '100%',
                    width:
                      i < si
                        ? '100%'
                        : i === si
                          ? progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            })
                          : '0%',
                  }}
                >
                  <View className="h-full bg-aura" />
                </Animated.View>
              </View>
            ))}
          </View>

          <View className="flex-row items-center justify-between px-5 py-3">
            <Text className="text-[14px] font-semibold text-foreground">{name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back', locale)}
              hitSlop={8}
              onPress={onClose}
            >
              <Text className="text-2xl text-foreground">✕</Text>
            </Pressable>
          </View>
        </SafeAreaView>

        <View
          className="flex-1"
          onLayout={(e) => setZoneW(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        />

        <SafeAreaView edges={['bottom']} className="gap-3 bg-background/70 px-5 pb-3 pt-3">
          {current.caption ? (
            <Text className="text-[14px] text-foreground">{current.caption}</Text>
          ) : null}
          {current.is_step ? (
            <Text className="text-[12px] text-aura">✦ {t('story.stepBadge', locale)}</Text>
          ) : null}

          {isOwn ? (
            <View className="gap-3">
              <Text className="text-[13px] text-faint">
                {t('story.own.stat', locale, { n: count })}
              </Text>
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  onPress={onAddMoment}
                  className="flex-1 items-center rounded-ctl border border-aura-line bg-aura-soft py-3"
                >
                  <Text className="text-[14px] text-aura">{t('story.own.add', locale)}</Text>
                </Pressable>
                {current.is_step && !current.pinned ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onPin(current)}
                    className="items-center justify-center rounded-ctl border border-hair px-4"
                  >
                    <Text className="text-[14px] text-foreground">
                      {t('story.own.pin', locale)}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDelete(current)}
                  className="items-center justify-center rounded-ctl border border-hair px-4"
                >
                  <Text className="text-[14px] text-muted-foreground">
                    {t('story.own.delete', locale)}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="gap-3">
              {/* Real composer (#297): send stays in the viewer. Send is a FLAT cyan surface —
                  same rule #4 reading as the chat send button; a routine send is not a glow. */}
              <View className="flex-row items-center gap-2">
                <TextInput
                  className="flex-1 rounded-full border border-hair bg-raise px-4 py-2 text-[15px] text-foreground"
                  placeholder={t('story.reply.placeholder', locale, { name })}
                  placeholderTextColor={semantic.faint}
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                  returnKeyType="send"
                  onSubmitEditing={sendReply}
                  editable={!sending}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('story.reply.send.a11y', locale, { name })}
                  disabled={!canSend}
                  onPress={sendReply}
                  className={`h-11 w-11 items-center justify-center rounded-full bg-aura ${
                    canSend ? '' : 'opacity-40'
                  }`}
                >
                  <Text className="text-[20px] text-on-aura">›</Text>
                </Pressable>
              </View>
              <View className="flex-row items-center gap-4">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewerReacted }}
                  accessibilityLabel={t(
                    viewerReacted ? 'story.react.a11yLit' : 'story.react.a11y',
                    locale,
                  )}
                  onPress={() => onReact(current)}
                  className="min-h-[44px] min-w-[44px] flex-row items-center justify-center"
                >
                  {/* Shape carries the state (✦ lit / ✧ unlit), as on ReactionStar and StarCell —
                      `faint` alone stopped reading "off" once it was retuned for AA. */}
                  <Text className={`text-[22px] ${viewerReacted ? 'text-aura' : 'text-faint'}`}>
                    {star(viewerReacted)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={onMakeDream}
                  className="flex-1 items-center rounded-ctl border border-aura-line bg-aura-soft py-3"
                >
                  <Text className="text-[14px] text-aura">{t('story.makeDream', locale)}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {replyToast ? (
        <Toast
          label={
            replyToast === 'sent'
              ? t('story.reply.sent', locale, { name })
              : t('story.reply.error', locale)
          }
          tone={replyToast === 'sent' ? 'success' : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: { flex: 1 },
});

function ViewerVideo({ uri, paused }: { uri: string; paused: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />;
}
