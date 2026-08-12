import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import { momentPosterPath } from '@/lib/media/moment-media';
import { Pressable, Text, View } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';

export type TileVariant = 'gallery' | 'full';

// Profilo gallery tiles = 14px radius (prototype .gallery .media);
// full-grid tiles = ~3px radius (prototype .grid-full .media).
const RADIUS: Record<TileVariant, string> = {
  gallery: 'rounded-ctl',
  full: 'rounded-sm',
};

/**
 * A single Momento media tile (1:1, fills its parent cell). The tile picks its own path out of
 * `urls` via `momentPosterPath`, because which object a tile draws is not which object the
 * lightbox opens: a video's tile wants its poster, and only the tile knows that.
 *
 * The signed URL renders through `MediaFrame`, so a tile whose URL is still signing looks
 * different from one whose URL is never coming (#135) — it used to be the same empty box either
 * way. A ▶ glyph marks video once there is something to play; a caption overlays the bottom in
 * every state, because the member's own words survive their media failing to load.
 *
 * A fourth state sits outside `MediaFrame` entirely: a video with no poster (#131). Nothing is
 * signing and nothing is broken, so neither the loading fill nor the ✦ «non si carica» is true —
 * the video plays perfectly, it just has no still to show. It gets the ▶ at `faint` weight, which
 * reads as placeholder rather than as the `foreground` ▶ sitting on top of a real poster.
 */
export function MomentTile({
  moment,
  variant,
  locale,
  urls,
  isLoading,
  onPress,
  onLongPress,
}: {
  moment: Moment;
  variant: TileVariant;
  locale: Locale;
  /** Signed URLs by storage path (from `useSignedUrls('moments', momentSignPaths(…))`). */
  urls: Record<string, string>;
  /** `useSignedUrls().isLoading`, which is what tells signing apart from gone. */
  isLoading: boolean;
  onPress: () => void;
  /** Owner-only soft-delete affordance (full grid). Omit elsewhere. */
  onLongPress?: () => void;
}) {
  const posterPath = momentPosterPath(moment);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={moment.caption ?? t('lightbox.label', locale)}
      onPress={onPress}
      onLongPress={onLongPress}
      className={`aspect-square w-full justify-end overflow-hidden bg-raise ${RADIUS[variant]}`}
    >
      {posterPath === null ? (
        <View
          className="absolute inset-0 items-center justify-center"
          accessible
          accessibilityLabel={t('media.noPoster.video', locale)}
        >
          <Text
            className="text-2xl text-faint"
            // Decorative: the wrapper above already announces the sentence (same pairing as
            // MediaFrame's compact unavailable state).
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            ▶
          </Text>
        </View>
      ) : (
        <MediaFrame
          // What renders is always a still image; `kind` is what the member came for, so a video
          // whose poster fails to load says so instead of blaming a photo.
          kind={moment.kind === 'video' ? 'video' : 'photo'}
          url={urls[posterPath]}
          isLoading={isLoading}
          locale={locale}
          compact
          className="absolute inset-0"
          overlay={
            moment.kind === 'video' ? (
              // Ready-state only: over the unavailable glyph this would be two centred marks on
              // top of each other, and ▶ would promise playback that isn't there.
              <View className="absolute inset-0 items-center justify-center">
                <Text className="text-2xl text-foreground">▶</Text>
              </View>
            ) : null
          }
        />
      )}
      {moment.caption ? (
        <Text
          numberOfLines={1}
          className="bg-surface-muted/40 px-2 py-1 text-[11px] text-foreground"
        >
          {moment.caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The trailing "+" tile. Create/upload is LIVE (M3): pressing it opens the
 * `MediaSheet` so the owner can add a Momento (see `useMomentUpload`). The add
 * writes only the `moments` table — never any Aura/score mutation (rule #1).
 */
export function MomentAddTile({
  variant,
  label,
  onPress,
}: {
  variant: TileVariant;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`aspect-square w-full items-center justify-center bg-raise ${RADIUS[variant]}`}
    >
      <Text className="text-2xl text-faint">+</Text>
    </Pressable>
  );
}
