import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { useQuery } from '@tanstack/react-query';
import { getPostMedia, postMediaKeys } from '@athanor/api';
import type { Locale, MediaKind } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { MediaFrame, type MediaFrameKind } from '@/components/media/MediaFrame';
import { aspectRatio, formatDuration } from '@/lib/media/format';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';

/** `post_media.kind` (schema vocabulary) → the word the copy uses. `image` is a column, `photo`
 *  is what a member reads. */
const MEDIA_KIND: Record<MediaKind, MediaFrameKind> = {
  image: 'photo',
  video: 'video',
  audio: 'audio',
};

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
  // Poster + media sign in the same call (momentSignPaths pattern): the card draws the thumb,
  // the detail plays the mp4, and the two share one path → url map.
  const { urls, isLoading: urlsLoading } = useSignedUrls(
    'post-media',
    rows.flatMap((r) => (r.thumb_path ? [r.storage_path, r.thumb_path] : [r.storage_path])),
  );

  if (!enabled) return null;

  // Media query still loading → a single skeleton box.
  if (mediaQuery.isLoading) {
    return (
      <View className="gap-2">
        <MediaFrame
          kind={MEDIA_KIND[postType]}
          isLoading
          locale={locale}
          className="rounded-card bg-raise"
          style={{ aspectRatio: 4 / 5 }}
        />
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

        // Still signing, or never coming — `MediaFrame` is what tells those two apart (#135).
        if (!url) {
          return (
            <MediaFrame
              key={row.id}
              kind={MEDIA_KIND[row.kind]}
              isLoading={urlsLoading}
              locale={locale}
              className="rounded-card bg-raise"
              style={{ aspectRatio: row.kind === 'audio' ? 4 / 1 : ratio }}
            />
          );
        }

        if (row.kind === 'image') {
          // Same frame, and now an `onError`: a URL that signs and then 404s says so instead of
          // rendering an empty card.
          return (
            <MediaFrame
              key={row.id}
              kind="photo"
              url={url}
              isLoading={urlsLoading}
              locale={locale}
              className="rounded-card bg-raise"
              style={{ aspectRatio: ratio }}
            />
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
                accessibilityRole="button"
                accessibilityLabel={t('feed.video.playLabel', locale)}
              >
                {row.thumb_path === null ? (
                  // A video with no poster is a STATE, not a failure (#318, MomentTile's fourth
                  // state): it plays fine in the detail, it just has no still. Faint ▶ so it
                  // reads as placeholder, not as the `foreground` ▶ over a real poster.
                  <View
                    className="absolute inset-0 items-center justify-center"
                    accessible
                    accessibilityLabel={t('media.noPoster.video', locale)}
                  >
                    <Text
                      className="text-4xl text-faint"
                      // Decorative: the wrapper above already announces the sentence.
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      ▶
                    </Text>
                  </View>
                ) : (
                  <MediaFrame
                    kind="video"
                    url={urls[row.thumb_path]}
                    isLoading={urlsLoading}
                    locale={locale}
                    className="absolute inset-0"
                    overlay={
                      // Ready-state only: ▶ over a real poster promises the playback that a tap
                      // delivers; over the unavailable ✦ it would promise the wrong thing.
                      <View className="absolute inset-0 items-center justify-center">
                        <Text className="text-4xl text-foreground">▶</Text>
                      </View>
                    }
                  />
                )}
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
