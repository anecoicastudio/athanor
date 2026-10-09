import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import { momentPosterPath } from '@/lib/media/moment-media';
import { PRESS_DIM } from '@/lib/press';
import { Pressable, View, cn } from '@/tw';
import { MediaFrame } from '@/components/media/MediaFrame';
import { AddIcon, PlayGlyph } from '@/components/glyphs';

/**
 * The one tile shape (DESIGN §8.5, the prototype's `.ph`; #921): a square of `surface`, radius
 * 14, with a hairline. The hairline is a view of its own drawn OVER the media ({@link Hairline}),
 * so a photo that fills the tile cannot cover it.
 */
const TILE = 'aspect-square w-full overflow-hidden rounded-[14px] bg-surface';

function Hairline() {
  return (
    <View pointerEvents="none" className="absolute inset-0 rounded-[14px] border border-hair" />
  );
}

/**
 * A single Momento media tile (1:1, fills its parent cell). The tile picks its own path out of
 * `urls` via `momentPosterPath`, because which object a tile draws is not which object the
 * lightbox opens: a video's tile wants its poster, and only the tile knows that.
 *
 * The signed URL renders through `MediaFrame`, so a tile whose URL is still signing looks
 * different from one whose URL is never coming (#135) — it used to be the same empty box either
 * way. The drawn play in a 52 disc marks a video once there is something to play. The tile shows
 * no caption (the prototype draws none, Marco 2026-10-06): the member's words are the tile's
 * spoken label here and are read under the media in the `Lightbox`.
 *
 * A fourth state sits outside `MediaFrame` entirely: a video with no poster (#131). Nothing is
 * signing and nothing is broken, so neither the loading fill nor the ✦ «non si carica» is true —
 * the video plays perfectly, it just has no still to show. It gets the play in the secondary grey
 * and no disc, which reads as placeholder rather than as the play standing on a real poster.
 */
export function MomentTile({
  moment,
  locale,
  urls,
  isLoading,
  onPress,
  onLongPress,
}: {
  moment: Moment;
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
  const label = moment.caption ?? t('lightbox.label', locale);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      // One composed label (#292): the Pressable is an accessibility element, so anything
      // `accessible` nested inside it may never be spoken — the no-poster sentence has to ride
      // the button's own label to reliably reach a screen reader.
      accessibilityLabel={
        posterPath === null ? `${label}, ${t('media.noPoster.video', locale)}` : label
      }
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn(TILE, PRESS_DIM)}
    >
      {posterPath === null ? (
        <View
          className="absolute inset-0 items-center justify-center"
          // Decorative: the no-poster sentence rides the Pressable's label above (#292).
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <PlayGlyph size={24} color={galleria.foregroundMuted} />
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
              // top of each other, and the play would promise playback that isn't there.
              <View className="absolute inset-0 items-center justify-center">
                <View className="h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full">
                  {/* The disc's fill is a layer, so its 55% does not dim the play. */}
                  <View className="absolute inset-0 bg-background opacity-55" />
                  <PlayGlyph size={22} color={galleria.foreground} />
                </View>
              </View>
            ) : null
          }
        />
      )}
      <Hairline />
    </Pressable>
  );
}

/**
 * The trailing add tile of the Profilo gallery: the same tile, holding the drawn `add`. Pressing
 * it opens the `MediaSheet` so the owner can add a Momento (see `useMomentUpload`). The add
 * writes only the `moments` table — never any Aura/score mutation (rule #1). The full grid has
 * no such tile: its header's add is the one way in there (Marco, 2026-10-06).
 */
export function MomentAddTile({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={cn(TILE, 'items-center justify-center', PRESS_DIM)}
    >
      <AddIcon size={22} color={galleria.foreground} />
      <Hairline />
    </Pressable>
  );
}
