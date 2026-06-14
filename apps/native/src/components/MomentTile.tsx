import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';

type TileVariant = 'gallery' | 'full';

// Profilo gallery tiles = 14px radius (prototype .gallery .media);
// full-grid tiles = ~3px radius (prototype .grid-full .media).
const RADIUS: Record<TileVariant, string> = {
  gallery: 'rounded-ctl',
  full: 'rounded-sm',
};

/**
 * A single Momento media tile (1:1, fills its parent cell). M1 renders a quiet
 * `raise` placeholder — no media yet (see types/moment.ts); M3 swaps in the
 * real image/video. A caption overlays the bottom when present.
 */
export function MomentTile({
  moment,
  variant,
  onPress,
}: {
  moment: Moment;
  variant: TileVariant;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={moment.caption ?? undefined}
      onPress={onPress}
      className={`aspect-square w-full justify-end overflow-hidden bg-raise ${RADIUS[variant]}`}
    >
      {moment.type === 'video' ? (
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
 * The trailing "+" tile. M1 create/upload is DEFERRED TO M3 (no `moments`
 * Storage bucket / `sheet-media` picker yet), so this is a quiet affordance —
 * pressing it surfaces an honest "in arrivo" hint via `onPress` rather than
 * faking an upload. Never calls any Aura/score mutation (rule #1).
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
