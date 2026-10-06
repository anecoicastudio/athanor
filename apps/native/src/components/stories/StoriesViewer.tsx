import { useEffect, useMemo, useState } from 'react';
import { Animated, Keyboard, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { galleria } from '@athanor/config';
import { t, tn } from '@athanor/i18n';
import type { Locale, StorySegment } from '@athanor/schemas';
import { Pressable, SafeAreaView, ScrollView, Text, View, cn } from '@/tw';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { CloseIcon, SendIcon } from '@/components/glyphs';
import { Input } from '@/components/Input';
import { MediaFrame } from '@/components/media/MediaFrame';
import { useToast } from '@/components/ToastHost';
import { keyboardCoversBottomInset, useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useVideoFailure } from '@/lib/media/use-video-failure';
import { PRESS_DIM } from '@/lib/press';
import { star } from '@/lib/star';

const PHOTO_MS = 5000;
const DEFAULT_VIDEO_MS = 15000;

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
 * above it in two scrim bands (`background` at 70%) — DESIGN.md §6 "Full-bleed media + overlay
 * chrome". Each band owns its safe-area edge via the per-view `SafeAreaView` (#161: the
 * `useSafeAreaInsets` hook is per-window and over-insets inside the iOS `(modal)` sheet).
 * The prototype stacks header, photo and caption on black instead; the full-bleed layout stays
 * (Marco, 2026-10-06) and takes the prototype's chrome (#921): 3px foreground steps on hairline,
 * the name in body medium, the drawn close, the shared pills. One cyan: «✦ Un passo del
 * percorso» (DESIGN §2.3).
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
  onAuthorPress,
  onReact,
  onSendReply,
  onMakeDream,
  onAddMoment,
  onPin,
  onDelete,
  onChromeHeight,
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
  /** Author name → author profile (#356); absent on the own story, where the name stays text. */
  onAuthorPress?: () => void;
  onReact: (segment: StorySegment) => void;
  /** Sends the reply into the DM without leaving the viewer; rejects on failure. */
  onSendReply: (body: string) => Promise<void>;
  /**
   * Measured height of the bottom chrome, so the host can lift the toast band clear of it
   * (#102). Fires again whenever the composer grows or the keyboard lifts the bar.
   */
  onChromeHeight?: (height: number) => void;
  onMakeDream: () => void;
  onAddMoment: () => void;
  onPin: (segment: StorySegment) => void;
  onDelete: (segment: StorySegment) => void;
}) {
  // A new `segments` identity is a person change (#298): open at the end `startAt` names.
  // `startAt` only means something with new segments, which is why it is read here and not
  // remembered. Derived rather than reset from an effect (#691) — the effect landed a commit
  // late, so `segments[si]` below ran once against the PREVIOUS person's index.
  const [cursor, setCursor] = useState<{ segments: StorySegment[]; i: number } | null>(null);
  const [paused, setPaused] = useState(false);
  // Tap-zone width from onLayout, not Dimensions-at-module-scope: that snapshot goes stale
  // after a rotation or in split view (#297 beyond-the-issue).
  const [zoneW, setZoneW] = useState(0);
  // Keyboard avoidance for the reply composer (#163, remeasured in #616). The media is a
  // full-bleed `absolute inset-0` sibling of this chrome, so padding the root would shrink
  // the photo with it — only the chrome band may carry the inset, which is why this screen
  // cannot take the `KeyboardAvoiding` wrapper. It reads the same hook rather than holding a
  // second copy of the measurement, which is what left it broken by every earlier fix.
  const keyboardInset = useKeyboardInset();
  const { height: windowHeight } = useWindowDimensions();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const { showToast } = useToast();
  const reduce = useReducedMotion();
  const progress = useAnimatedValue(0);
  const openAt = startAt === 'last' ? Math.max(0, segments.length - 1) : 0;
  const si = cursor?.segments === segments ? cursor.i : openAt;
  const current = segments[si];
  const currentUrl = current ? urls[current.storage_path] : undefined;

  const goNext = () => {
    if (si + 1 < segments.length) setCursor({ segments, i: si + 1 });
    else onAdvanceEnd();
  };
  const goPrev = () => {
    if (si > 0) setCursor({ segments, i: si - 1 });
    else onAdvanceStart();
  };

  // The segment clock waits for its media (#748). It used to start the moment `current` existed,
  // so on a slow signing round-trip a 5s photo could expire before it ever drew — and the next
  // person in the chain is your own story whenever it is unseen — the likeliest reading of
  // "tapped someone's ring, got my own story" (unconfirmed on device). A URL that settled into nothing still starts it: the frame shows its
  // unavailable state and the story moves on rather than stalling.
  const mediaReady = Boolean(currentUrl) || !urlsLoading;

  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    if (paused || !mediaReady) return;
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
  }, [si, paused, current?.id, reduce, mediaReady]);

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
      showToast(t('story.reply.sent', locale, { name }), 'success');
    } catch {
      showToast(t('story.reply.error', locale));
    } finally {
      setSending(false);
    }
  };

  if (!current) return null;

  return (
    <View className="flex-1 bg-background">
      {current.kind === 'video' ? (
        <MediaFrame
          kind="video"
          url={currentUrl}
          isLoading={urlsLoading}
          locale={locale}
          className="absolute inset-0"
        >
          {(uri, onFailure) => (
            <ViewerVideo key={current.id} uri={uri} paused={paused} onError={onFailure} />
          )}
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

      <View style={[styles.chrome, { paddingBottom: keyboardInset }]}>
        <SafeAreaView edges={['top']}>
          {/* The band's scrim, a layer of its own: `bg-background/70` on the band drew nothing
              (iPhone SE simulator, Expo Go, 2026-10-06: the photo kept its pixels under the
              name), and an opacity on the band would dim its controls too. */}
          <View pointerEvents="none" className="absolute inset-0 bg-background opacity-70" />
          {/* One 3px step per segment, 6 apart, foreground on hairline (the prototype's
              `.steps`). */}
          <View className="flex-row gap-1.5 px-5 pt-3">
            {segments.map((seg, i) => (
              <View key={seg.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-hair">
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
                  <View className="h-full bg-foreground" />
                </Animated.View>
              </View>
            ))}
          </View>

          <View className="flex-row items-center justify-between gap-3 px-5 py-2">
            {/* The name is the exit to the author's profile (#356). Press vs pan never fight:
                the PanResponder is attached to the sibling swipe-zone View below, not here. */}
            {onAuthorPress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('connection.a11y.open', locale, { name })}
                hitSlop={{ left: 8, right: 8 }}
                onPress={onAuthorPress}
                className={cn('min-h-[44px] shrink justify-center', PRESS_DIM)}
              >
                <Text className="type-body font-medium text-foreground">{name}</Text>
              </Pressable>
            ) : (
              <Text className="type-body shrink font-medium text-foreground">{name}</Text>
            )}
            {/* The drawn close in a 44pt box, 12 past the gutter like `HeaderClose`. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close', locale)}
              onPress={onClose}
              className={cn(
                '-mr-3 min-h-[44px] min-w-[44px] items-center justify-center',
                PRESS_DIM,
              )}
            >
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <CloseIcon size={22} color={galleria.foreground} />
              </View>
            </Pressable>
          </View>
        </SafeAreaView>

        <View
          className="flex-1"
          onLayout={(e) => setZoneW(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        />

        {/* Physical `pl-5 pr-5`, not `px-5` (#748): on native `px-*` compiles to the logical
            inline-start/end pair, which this SafeAreaView drops — the caption sat on the edge.
            The bottom edge goes while the keyboard lifts the chrome on iOS, where its height
            already spans the home indicator (#765, `keyboardCoversBottomInset`). */}
        <SafeAreaView
          edges={keyboardInset > 0 && keyboardCoversBottomInset ? [] : ['bottom']}
          className="gap-3 pb-3 pl-5 pr-5 pt-3"
          onLayout={(e) => onChromeHeight?.(e.nativeEvent.layout.height)}
        >
          <View pointerEvents="none" className="absolute inset-0 bg-background opacity-70" />
          {current.caption || current.is_step ? (
            <View className="gap-2">
              {/* A caption can be long. It scrolls inside a third of the window, so the controls
                  below stay on the screen: at AX5 on the iPhone SE simulator (Expo Go, 2026-10-06)
                  a 768pt caption stood in 222pt and the last pill ended at 655 of 667. */}
              {current.caption ? (
                <ScrollView style={{ maxHeight: windowHeight / 3 }} alwaysBounceVertical={false}>
                  <Text className="type-body text-foreground">{current.caption}</Text>
                </ScrollView>
              ) : null}
              {/* The one cyan of the viewer: a step of the journey is one of the five marks. */}
              {current.is_step ? (
                <Text className="type-label text-aura">✦ {t('story.stepBadge', locale)}</Text>
              ) : null}
            </View>
          ) : null}

          {isOwn ? (
            <View className="gap-3">
              <Text className="type-small text-muted-foreground">
                {tn('story.own.stat', count, locale)}
              </Text>
              {/* The add on its own row, the two others wrapping below it (#748): three buttons in
                  one non-wrapping row pushed «Elimina» off the right edge in Italian. */}
              <Button variant="outline" label={t('story.own.add', locale)} onPress={onAddMoment} />
              <ButtonRow>
                {current.is_step && !current.pinned ? (
                  <Button
                    variant="outline"
                    size="sm"
                    label={t('story.own.pin', locale)}
                    onPress={() => onPin(current)}
                  />
                ) : null}
                <Button
                  variant="destructive"
                  size="sm"
                  label={t('story.own.delete', locale)}
                  onPress={() => onDelete(current)}
                />
              </ButtonRow>
            </View>
          ) : (
            <View className="gap-3">
              {/* Real composer (#297): send stays in the viewer. The bar is the post's (Marco,
                  2026-10-06): the small field and a white 44pt disc with the drawn send, dimmed
                  and disabled while there is nothing to send, never unmounted (a control that
                  mounts beside a field on the first character lost keystrokes:
                  `search/SearchBar`'s docblock has the counts). */}
              <View className="flex-row items-center gap-2">
                <Input
                  className="flex-1"
                  size="sm"
                  placeholder={t('story.reply.placeholder', locale, { name })}
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
                  accessibilityState={{ disabled: !canSend }}
                  disabled={!canSend}
                  onPress={sendReply}
                  className={cn(
                    'h-[44px] w-[44px] items-center justify-center rounded-full bg-foreground',
                    PRESS_DIM,
                    canSend ? null : 'opacity-40',
                  )}
                >
                  <SendIcon size={22} color={galleria.background} />
                </Pressable>
              </View>
              <View className="flex-row flex-wrap items-center justify-between gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewerReacted }}
                  accessibilityLabel={t(
                    viewerReacted ? 'story.react.a11yLit' : 'story.react.a11y',
                    locale,
                  )}
                  onPress={() => onReact(current)}
                  className={cn(
                    'min-h-[44px] min-w-[44px] flex-row items-center justify-center',
                    PRESS_DIM,
                  )}
                >
                  {/* Shape carries the state (✦ lit / ✧ unlit), as on ReactionStar and the six
                      stars' rows; a lit star is foreground, never cyan (DESIGN §2.3). */}
                  <Text
                    className={cn(
                      'text-[22px]',
                      viewerReacted ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {star(viewerReacted)}
                  </Text>
                </Pressable>
                <Button
                  variant="outline"
                  size="sm"
                  label={t('story.makeDream', locale)}
                  onPress={onMakeDream}
                />
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: { flex: 1 },
});

function ViewerVideo({
  uri,
  paused,
  onError,
}: {
  uri: string;
  paused: boolean;
  onError: () => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  // A story-segment URL lives 300s and re-signs on a 240s timer, so a paused or backgrounded
  // story can outlive its URL mid-mount — the exact case #278 was filed about.
  useVideoFailure(player, onError);
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);
  // No native controls (#748): expo-video defaults them ON, and on Android they drew a play
  // button and seek bar over the story and through the own-story action row. The story owns
  // its gestures and progress bars; the player is only a surface.
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}
