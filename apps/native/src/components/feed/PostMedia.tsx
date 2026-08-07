import { Image, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { useQuery } from '@tanstack/react-query';
import { getPostMedia, postMediaKeys } from '@athanor/api';
import type { Locale, PostMedia as PostMediaRow } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';

/** Seconds → `M:SS` (165 → "2:45"). Null/negative → "". */
function formatDuration(s: number | null): string {
  if (s === null || s < 0) return '';
  const total = Math.floor(s);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Aspect ratio from intrinsic dims; fallback 4:5 (portrait) when unknown. */
function aspectRatio(media: PostMediaRow): number {
  if (media.width && media.height && media.height > 0) return media.width / media.height;
  return 4 / 5;
}

/** A muted box used for loading skeletons and sign-fail placeholders. */
function MediaBox({ children, ratio }: { children?: React.ReactNode; ratio: number }) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-card bg-raise"
      style={{ aspectRatio: ratio }}
    >
      {children}
    </View>
  );
}

/** Detail-only real video player — owns its own `useVideoPlayer` hook. */
function DetailVideo({ url, ratio }: { url: string; ratio: number }) {
  const player = useVideoPlayer(url);
  return (
    <View className="overflow-hidden rounded-card bg-raise" style={{ aspectRatio: ratio }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" />
    </View>
  );
}

/** Detail-only audio control — owns its own `useAudioPlayer` hook. */
function DetailAudio({ url, label }: { url: string; label: string }) {
  const player = useAudioPlayer(url);
  return (
    <Pressable
      className="flex-row items-center gap-3 self-start rounded-ctl border border-hair bg-raise px-4 py-3"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (player.playing ? player.pause() : player.play())}
    >
      <Text className="text-[18px] text-foreground">{player.playing ? '⏸' : '▶'}</Text>
      <Text className="text-[13px] text-foreground">🎧 {label}</Text>
    </Pressable>
  );
}

type Props = {
  postId: string;
  postType: 'text' | 'image' | 'video' | 'audio';
  variant: 'card' | 'detail';
  locale: Locale;
  onPress?: () => void;
};

/**
 * Renders a post's attached media (image / video / audio), §post-media plan task 13.
 * Text posts short-circuit to `null` BEFORE querying — most feed posts are text, so we
 * avoid a network round-trip per card. No glow (rule #4 — media isn't a moment), no public
 * counts (rule #3). The card variant is static (no autoplay in a scroll list) and taps
 * through to the detail via `onPress`; the detail variant mounts real players.
 */
export function PostMedia({ postId, postType, variant, locale, onPress }: Props) {
  // Short-circuit text posts: render nothing and never hit the network.
  const enabled = postType !== 'text';

  const mediaQuery = useQuery({
    queryKey: postMediaKeys.forPost(postId),
    queryFn: () => getPostMedia(supabase, postId),
    enabled,
  });
  const rows = mediaQuery.data ?? [];
  const { urls } = useSignedUrls(
    'post-media',
    rows.map((r) => r.storage_path),
  );

  if (!enabled) return null;

  // Media query still loading → a single skeleton box.
  if (mediaQuery.isLoading) {
    return (
      <View className="gap-2">
        <MediaBox ratio={4 / 5} />
      </View>
    );
  }
  if (rows.length === 0) return null;

  return (
    <View className="gap-2">
      {rows.map((row) => {
        const url = urls[row.storage_path];
        const ratio = aspectRatio(row);
        const durLabel = t('feed.audio', locale, { dur: formatDuration(row.duration_s) });

        // No URL yet (signing) or sign-fail → muted placeholder, never crash.
        if (!url) {
          return <MediaBox key={row.id} ratio={row.kind === 'audio' ? 4 / 1 : ratio} />;
        }

        if (row.kind === 'image') {
          return (
            <View
              key={row.id}
              className="overflow-hidden rounded-card bg-raise"
              style={{ aspectRatio: ratio }}
            >
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </View>
          );
        }

        if (row.kind === 'video') {
          if (variant === 'card') {
            const dur = formatDuration(row.duration_s);
            return (
              <Pressable
                key={row.id}
                className="items-center justify-center overflow-hidden rounded-card bg-raise"
                style={{ aspectRatio: ratio }}
                onPress={onPress}
              >
                <Text className="text-4xl text-foreground">▶</Text>
                {dur ? (
                  <View className="absolute bottom-2 right-2 rounded-ctl bg-surface-muted px-2 py-0.5">
                    <Text className="text-[11px] text-foreground">{dur}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }
          return <DetailVideo key={row.id} url={url} ratio={ratio} />;
        }

        // audio
        if (variant === 'card') {
          return (
            <Pressable
              key={row.id}
              className="flex-row items-center gap-2 self-start rounded-ctl border border-hair bg-raise px-4 py-3"
              onPress={onPress}
            >
              <Text className="text-[13px] text-foreground">🎧 {durLabel}</Text>
            </Pressable>
          );
        }
        return <DetailAudio key={row.id} url={url} label={durLabel} />;
      })}
    </View>
  );
}
