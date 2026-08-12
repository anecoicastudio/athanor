import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
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
 * A single Momento media tile (1:1, fills its parent cell). The signed `url` (thumb or media)
 * renders through `MediaFrame`, so a tile whose URL is still signing looks different from one
 * whose URL is never coming (#135) — it used to be the same empty box either way. A ▶ glyph
 * marks video once there is something to play; a caption overlays the bottom in every state,
 * because the member's own words survive their media failing to load.
 */
export function MomentTile({
  moment,
  variant,
  locale,
  url,
  isLoading,
  onPress,
  onLongPress,
}: {
  moment: Moment;
  variant: TileVariant;
  locale: Locale;
  /** Signed URL for `moment.media_path` (or thumb). Undefined → loading or unavailable. */
  url?: string;
  /** `useSignedUrls().isLoading`, which is what tells those two apart. */
  isLoading: boolean;
  onPress: () => void;
  /** Owner-only soft-delete affordance (full grid). Omit elsewhere. */
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={moment.caption ?? t('lightbox.label', locale)}
      onPress={onPress}
      onLongPress={onLongPress}
      className={`aspect-square w-full justify-end overflow-hidden bg-raise ${RADIUS[variant]}`}
    >
      <MediaFrame
        // What renders is always the thumbnail image; `kind` is what the member came for, so a
        // video Momento with no thumb says so instead of blaming a photo.
        kind={moment.kind === 'video' ? 'video' : 'photo'}
        url={url}
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
