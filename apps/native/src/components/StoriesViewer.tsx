import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Image, PanResponder, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { type Locale, t } from '@athanor/i18n';
import type { StorySegment } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';

const { width: SCREEN_W } = Dimensions.get('window');
const PHOTO_MS = 5000;
const DEFAULT_VIDEO_MS = 15000;

function segmentMs(seg: StorySegment): number {
  if (seg.kind === 'video') return (seg.duration_s ?? DEFAULT_VIDEO_MS / 1000) * 1000;
  return PHOTO_MS;
}

/**
 * Plays one person's story (frontend §3.4). Segments auto-advance (photo 5s, video by duration);
 * tap right third → next, left third → prev, hold → pause, swipe down → close. `isOwn` swaps the
 * action set. `count` (author-only celebration total) renders only when `isOwn`. All counts are
 * owner-only (rule #3); the ✦ react is viewer-state only.
 */
export function StoriesViewer({
  segments,
  urls,
  name,
  isOwn,
  viewerReacted,
  count,
  locale,
  onClose,
  onAdvanceEnd,
  onReact,
  onReply,
  onMakeDream,
  onAddMoment,
  onPin,
}: {
  segments: StorySegment[];
  urls: Record<string, string>;
  name: string;
  isOwn: boolean;
  viewerReacted: boolean;
  count: number;
  locale: Locale;
  onClose: () => void;
  onAdvanceEnd: () => void;
  onReact: (segment: StorySegment) => void;
  onReply: () => void;
  onMakeDream: () => void;
  onAddMoment: () => void;
  onPin: (segment: StorySegment) => void;
}) {
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const current = segments[si];
  const currentUrl = current ? urls[current.storage_path] : undefined;

  useEffect(() => {
    setSi(0);
  }, [segments]);

  const goNext = () => {
    if (si + 1 < segments.length) setSi(si + 1);
    else onAdvanceEnd();
  };
  const goPrev = () => {
    if (si > 0) setSi(si - 1);
  };

  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    if (paused) return;
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
  }, [si, paused, current?.id]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8,
        onPanResponderGrant: () => setPaused(true),
        onPanResponderRelease: (e, g) => {
          setPaused(false);
          if (g.dy > 100) {
            onClose();
            return;
          }
          if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
            if (e.nativeEvent.locationX < SCREEN_W / 3) goPrev();
            else goNext();
          }
        },
        onPanResponderTerminate: () => setPaused(false),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [si, segments.length],
  );

  if (!current) return null;

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row gap-1 px-3 pt-14">
        {segments.map((seg, i) => (
          <View key={seg.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-hair">
            <Animated.View
              className="h-full bg-aura"
              style={{
                width:
                  i < si
                    ? '100%'
                    : i === si
                      ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                      : '0%',
              }}
            />
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

      <View className="flex-1" {...pan.panHandlers}>
        <View className="flex-1 items-center justify-center px-4">
          <View className="aspect-[9/16] w-full overflow-hidden rounded-card bg-raise">
            {current.kind === 'video' ? (
              currentUrl ? (
                <ViewerVideo key={current.id} uri={currentUrl} paused={paused} />
              ) : (
                <View className="absolute inset-0 items-center justify-center">
                  <Text className="text-4xl text-foreground">▶</Text>
                </View>
              )
            ) : currentUrl ? (
              <Image
                source={{ uri: currentUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : null}
          </View>
        </View>
      </View>

      <View className="gap-3 px-5 pb-10 pt-3">
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
                  <Text className="text-[14px] text-foreground">{t('story.own.pin', locale)}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={onReply}
              className="rounded-ctl border border-hair bg-raise px-4 py-3"
            >
              <Text className="text-[14px] text-faint">
                {t('story.reply.placeholder', locale, { name })}
              </Text>
            </Pressable>
            <View className="flex-row items-center gap-4">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: viewerReacted }}
                accessibilityLabel={t('story.react.a11y', locale)}
                onPress={() => onReact(current)}
                className="min-h-[44px] min-w-[44px] flex-row items-center justify-center"
              >
                <Text className={`text-[22px] ${viewerReacted ? 'text-aura' : 'text-faint'}`}>
                  ✦
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
      </View>
    </View>
  );
}

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
