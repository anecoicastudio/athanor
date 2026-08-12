import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { type MessageKey, t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { mediaState } from '@/lib/media/media-state';

export type MediaKind = 'photo' | 'video' | 'audio';

const UNAVAILABLE: Record<MediaKind, MessageKey> = {
  photo: 'media.unavailable.photo',
  video: 'media.unavailable.video',
  audio: 'media.unavailable.audio',
};

type Props = {
  /** Signed URL for this item, from `useSignedUrls`. Undefined until it signs, or forever. */
  url?: string;
  /** The signing query's `isLoading`. Thread it — dropping it is the bug this fixes (#135). */
  isLoading: boolean;
  /** What the member is missing — picks the copy, not the renderer. */
  kind: MediaKind;
  locale: Locale;
  /** Tile-sized surfaces: the glyph alone, sentence moved to the a11y label. */
  compact?: boolean;
  /** Frame classes from the caller — aspect ratio, radius, usually `absolute inset-0`. */
  className?: string;
  /** For the one caller whose aspect ratio is per-row data rather than a class. */
  style?: StyleProp<ViewStyle>;
  /**
   * Ready-state renderer, for the kinds `expo-image` cannot draw: the video and audio players.
   * A render prop rather than a node, so a player is only ever constructed with a URL in hand —
   * the old `url ? <Player uri={url}/> : ▶` shape could not express that. Omit it and the ready
   * state is the image at `url`, which is what a thumbnail-backed tile wants even for a video.
   */
  children?: (url: string) => ReactNode;
  /** Chrome that belongs on top of ready media only — a ▶ marker, a duration chip. */
  overlay?: ReactNode;
};

/**
 * The three states a private-media surface can be in, in one place (issue #135).
 *
 * Every media surface used to spell this as one `url ? … : …`, so "still signing" and "never
 * coming" were the same pixel — and for photos that pixel was `null` inside a full-height
 * frame, while video in the same state got a `▶`. Two kinds, two different failures, neither
 * saying anything.
 *
 * Owns the frame's *fill*, not the frame: each call site keeps its own box, because the aspect
 * ratios differ (9/16 story, 4/5 lightbox, 1/1 tile, per-row in the feed) and a tile's caption
 * has to stay legible across all three states.
 *
 * Photos render through `expo-image` for one reason above the fade: it has a real `onError`, so
 * a URL that signs fine and then 404s — a deleted object, a TTL that lapsed mid-view — becomes
 * the unavailable state instead of silence.
 *
 * `kind` picks the copy and nothing else, because the two can disagree: a video Momento's tile
 * draws a *thumbnail*, so what renders is an image while what the member is missing is a video.
 *
 * No glow anywhere here: `aura`, `auraSoft` and `auraLine` mean a moment happened (rule #4), and
 * media failing to load is the opposite of that.
 */
export function MediaFrame({
  url,
  isLoading,
  kind,
  locale,
  compact = false,
  className,
  style,
  children,
  overlay,
}: Props) {
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();

  // A re-signed URL deserves a fresh attempt: story-segments re-sign every 240s, so the URL that
  // 404'd is not the URL the next render gets.
  useEffect(() => setFailed(false), [url]);

  const state = mediaState({ url, isLoading, failed });
  // `mediaState` only says ready when `url` is non-empty; re-deriving it here is what lets the
  // ready branch hand a `string` to expo-image and to `children` without an assertion.
  const readyUrl = state === 'ready' ? url : undefined;

  return (
    // No `bg-raise` here: every call site's frame already carries it, and `raise` is translucent
    // white — a second layer compounds it and quietly lightens the placeholder.
    <View className={cn('overflow-hidden', className)} style={style}>
      {state === 'loading' ? (
        <View
          className="absolute inset-0 bg-raise-2"
          accessible
          accessibilityLabel={t('media.loading', locale)}
        />
      ) : readyUrl ? (
        <>
          {children ? (
            children(readyUrl)
          ) : (
            <ExpoImage
              source={{ uri: readyUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              // Reduced motion replaces transitions with a cut (DESIGN §10).
              transition={reduce ? 0 : 200}
              // Tiles recycle in a grid; without this a scrolled-away image can flash in the cell
              // that took its place.
              recyclingKey={readyUrl}
              onError={() => setFailed(true)}
            />
          )}
          {overlay}
        </>
      ) : (
        <View className="absolute inset-0 items-center justify-center px-4">
          {compact ? (
            // A gallery tile is about a third of the screen wide — EmptyState's body line would
            // clip, so the ✦ carries it visually (same glyph and `faint` weight as EmptyState)
            // and the label carries the sentence for a screen reader.
            <View accessible accessibilityLabel={t(UNAVAILABLE[kind], locale)}>
              <Text className="text-2xl text-faint">✦</Text>
            </View>
          ) : (
            <EmptyState>{t(UNAVAILABLE[kind], locale)}</EmptyState>
          )}
        </View>
      )}
    </View>
  );
}
