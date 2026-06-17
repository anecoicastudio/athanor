import { View } from '@/tw';
import { StarCell } from '@/components/aura/StarCell';
import { STAR_KEYS, type Locale, type Star, type StarKey } from '@athanor/schemas';

/**
 * Six Stars grid — live from the engine's `stars` table (M6).
 * Iterates `STAR_KEYS` canonical order; resolves each `Star` row from the array.
 * A missing row (engine dormant / unearned) coalesces to unearned.
 * Others' unearned cells render null so the grid naturally shows only earned.
 */
export function SixStarsGrid({
  stars,
  viewerIsOwner,
  locale,
  onStarPress,
}: {
  stars: Star[];
  viewerIsOwner: boolean;
  locale: Locale;
  onStarPress?: (starId: StarKey) => void;
}) {
  return (
    <View className="flex-row flex-wrap">
      {STAR_KEYS.map((key) => {
        const row = stars.find((s) => s.starId === key);
        const earned = row?.grantedAt != null;
        return (
          <StarCell
            key={key}
            starId={key}
            earned={earned}
            viewerIsOwner={viewerIsOwner}
            locale={locale}
            onPress={onStarPress ? () => onStarPress(key) : undefined}
          />
        );
      })}
    </View>
  );
}
