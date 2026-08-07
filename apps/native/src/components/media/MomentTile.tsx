import { Image, StyleSheet } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';

export type TileVariant = 'gallery' | 'full';

// Profilo gallery tiles = 14px radius (prototype .gallery .media);
// full-grid tiles = ~3px radius (prototype .grid-full .media).
const RADIUS: Record<TileVariant, string> = {
  gallery: 'rounded-ctl',
  full: 'rounded-sm',
};

/**
 * A single Momento media tile (1:1, fills its parent cell). Renders the signed
 * `url` (thumb or media) as a cover image when available; falls back to a quiet
 * `raise` box while the URL loads or fails to sign. A ▶ glyph marks video; a
 * caption overlays the bottom when present.
 */
export function MomentTile({
  moment,
  variant,
  locale,
  url,
  onPress,
  onLongPress,
}: {
  moment: Moment;
  variant: TileVariant;
  locale: Locale;
  /** Signed URL for `moment.media_path` (or thumb). Undefined → placeholder. */
  url?: string;
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
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {moment.kind === 'video' ? (
        <View className="absolute inset-0 items-center justify-center">
          <Text className="text-2xl text-foreground">▶</Text>
        </View>
      ) : null}
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
