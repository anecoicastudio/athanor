import { Text, View } from '@/tw';
import { StarCell } from '@/components/aura/StarCell';
import { t } from '@athanor/i18n';
import { STAR_KEYS, type Locale, type Star, type StarKey } from '@athanor/schemas';
import { STAR, starCellState, starsBlockMode } from '@/lib/star';

/**
 * Six Stars grid — live from the engine's `stars` table (M6).
 * Iterates `STAR_KEYS` canonical order; resolves each `Star` row from the array.
 * A missing row (engine dormant / unearned) coalesces to unearned.
 * Others' unearned cells render null so the grid naturally shows only earned.
 *
 * `stars === null` is the read having FAILED, which is not the same as an empty array
 * (issue #16). Which of the two blocks renders is `starsBlockMode`'s call — see there for why
 * the owner gets six unknown cells and anyone else gets one line.
 */
export function SixStarsGrid({
  stars,
  viewerIsOwner,
  locale,
  onStarPress,
}: {
  stars: Star[] | null;
  viewerIsOwner: boolean;
  locale: Locale;
  onStarPress?: (starId: StarKey) => void;
}) {
  if (starsBlockMode(stars, viewerIsOwner) === 'unavailable') {
    // `Text` rather than a wrapped View: it is an accessibility element by default, so the
    // sentence is what a screen reader announces instead of the bare em dash.
    return (
      <Text accessibilityLabel={t('profile.stars.theirUnavailable', locale)} className="text-faint">
        {STAR.unknown}
      </Text>
    );
  }

  return (
    <View className="flex-row flex-wrap">
      {STAR_KEYS.map((key) => {
        const state = starCellState(stars, key);
        return (
          <StarCell
            key={key}
            starId={key}
            state={state}
            viewerIsOwner={viewerIsOwner}
            locale={locale}
            // An unknown cell opens nothing — see StarCell.
            onPress={onStarPress && state !== 'unknown' ? () => onStarPress(key) : undefined}
          />
        );
      })}
    </View>
  );
}
