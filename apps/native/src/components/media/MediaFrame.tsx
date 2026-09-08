import { type ReactNode, useCallback, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { type MessageKey, t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { mediaState } from '@/lib/media/media-state';

/**
 * Which sentence the unavailable state uses. Deliberately NOT `@athanor/schemas`' `MediaKind`:
 * that one is the `post_media.kind` column and says `image`, while the copy here says `photo`
 * because that is the word a member reads. Same three concepts, two vocabularies, so they get
 * two names rather than one name that silently means either.
 */
export type MediaFrameKind = 'photo' | 'video' | 'audio';

const UNAVAILABLE: Record<MediaFrameKind, MessageKey> = {
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
  kind: MediaFrameKind;
  locale: Locale;
  /** Tile-sized surfaces: the glyph alone, sentence moved to the a11y label. */
  compact?: boolean;
  /** Frame classes from the caller — aspect ratio, radius, usually `absolute inset-0`. */
  className?: string;
  /** For the one caller whose aspect ratio is per-row data rather than a class. */
  style?: StyleProp<ViewStyle>;
  /**
   * How the ready photo fills the frame. `cover` for every fixed box — a tile, a bubble, a
   * story segment — where a letterboxed image would leave the box half empty and the grid
   * ragged. `contain` for a fullscreen viewer, whose whole reason to exist is showing the
   * parts the cropped frame cut off. Ignored when `children` draws the ready state: a player
   * owns its own fit.
   */
  contentFit?: 'cover' | 'contain';
  /**
   * Ready-state renderer, for the kinds `expo-image` cannot draw: the video and audio players.
   * A render prop rather than a node, so a player is only ever constructed with a URL in hand —
   * the old `url ? <Player uri={url}/> : ▶` shape could not express that. Omit it and the ready
   * state is the image at `url`, which is what a thumbnail-backed tile wants even for a video.
   *
   * The second argument is the player's way to report a dead URL back up (#278) — it flips this
   * frame to unavailable, the same `failed` the photo path sets through `onError`. One state,
   * two reporters, so a re-signed `url` clears both the same way.
   */
  children?: (url: string, onFailure: () => void) => ReactNode;
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
 * the unavailable state instead of silence. Players arriving through `children` report the same
 * failure through the render prop's second argument (#278): video from `expo-video`'s error
 * status (`useVideoFailure`), audio by inference at its own call site, because `expo-audio`
 * exposes no playback error at all — see `DetailAudio` in `PostMedia`.
 *
 * `kind` picks the copy and nothing else, because the two can disagree: a video Momento's tile
 * draws a *thumbnail*, so what renders is an image while what the member is missing is a video.
 *
 * No glow and no cyan anywhere here. What rule #4 reserves for moments is the GLOW — `auraGlow()`
 * laid over an `auraSoft`/`auraLine` surface (§2.3, ruled 2026-09-07); the framed pair on its own
 * only marks something active, and a frame standing in for media that failed to load is neither
 * active nor a moment. It stays the quietest thing on the screen.
 */
export function MediaFrame({
  url,
  isLoading,
  kind,
  locale,
  compact = false,
  className,
  style,
  contentFit = 'cover',
  children,
  overlay,
}: Props) {
  // The URL that failed, rather than a bare flag. A re-signed URL is a different string, so
  // "give it a fresh attempt" is a comparison during render instead of a `setState` in an
  // effect (#691) — and it can no longer show one render of the OLD failure against a NEW
  // url, which is the window the effect left open.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = url !== undefined && failedUrl === url;
  const reduce = useReducedMotion();

  // Stable per URL so a player's failure effect doesn't re-fire on every parent render. It
  // does re-fire when the URL changes, which is correct: that is a different attempt.
  const reportFailure = useCallback(() => setFailedUrl(url ?? null), [url]);

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
            children(readyUrl, reportFailure)
          ) : (
            <ExpoImage
              source={{ uri: readyUrl }}
              style={StyleSheet.absoluteFill}
              contentFit={contentFit}
              // Reduced motion replaces transitions with a cut (DESIGN §10).
              transition={reduce ? 0 : 200}
              // Tiles recycle in a grid; without this a scrolled-away image can flash in the cell
              // that took its place.
              recyclingKey={readyUrl}
              onError={() => setFailedUrl(url ?? null)}
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
              <Text
                className="text-2xl text-faint"
                // Decorative: the wrapper above already announces the sentence, and without this
                // the glyph is read as a second element (same pairing as EmptyState).
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                ✦
              </Text>
            </View>
          ) : (
            <EmptyState>{t(UNAVAILABLE[kind], locale)}</EmptyState>
          )}
        </View>
      )}
    </View>
  );
}
