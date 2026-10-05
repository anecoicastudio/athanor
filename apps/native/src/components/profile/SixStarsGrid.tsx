import { Text } from '@/tw';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { t, type MessageKey } from '@athanor/i18n';
import { STAR_KEYS, type Locale, type Star, type StarKey } from '@athanor/schemas';
import { STAR, starCellState, starGlyph, starsBlockMode } from '@/lib/star';

/**
 * The six stars — live from the engine's `stars` table (M6) — as the rows of one group under
 * «Le sei stelle» (a 3×2 grid of cells until 2026-10-05; the file keeps its name).
 * Iterates `STAR_KEYS` canonical order; resolves each `Star` row from the array.
 * A missing row (engine dormant / unearned) coalesces to unearned.
 *
 * One row per state, and the state is in the glyph and in the word on the right (DESIGN §11,
 * 2026-08-08: state lives in the glyph, never in a dimmer colour):
 * - lit → «✦ name», «accesa». Not a control.
 * - own, unlit → «✧ name», «spenta ›», one button to the star's sheet, named «name, spenta».
 * - own, unknown → «— name», «non disponibile». NOT a control: the sheet behind it would show
 *   criteria and a progress bar for a star whose progress could not be read, the same false
 *   claim one tap deeper (issue #16).
 * - another member's unlit star → no row at all (rule #3: no «what they are missing»).
 *
 * `stars === null` is the read having FAILED, which is not the same as an empty array
 * (issue #16). Which of the two blocks renders is `starsBlockMode`'s call — see there for why
 * the owner gets six unknown rows and anyone else gets one line. Six unknown rows on someone
 * else's profile would be MORE rows than a real profile with two lit stars.
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
  const mode = starsBlockMode(stars, viewerIsOwner);
  // `ProfileBody` drops the whole block, label included; this keeps any other caller honest.
  if (mode === 'hidden') return null;
  if (mode === 'unavailable') {
    // `Text` rather than a wrapped View: it is an accessibility element by default, so the
    // sentence is what a screen reader announces instead of the bare em dash.
    return (
      <Text
        accessibilityLabel={t('profile.stars.theirUnavailable', locale)}
        className="type-body text-muted-foreground"
      >
        {STAR.unknown}
      </Text>
    );
  }

  return (
    <RowGroup label={t('profile.stars.title', locale)}>
      {STAR_KEYS.map((key) => {
        const state = starCellState(stars, key);
        // Others' unearned stars are hidden (rule #3); others' unknown never gets here.
        if (state !== 'lit' && !viewerIsOwner) return null;
        const name = t(`star.${key}` as MessageKey, locale);
        const stateWord = t(
          state === 'lit' ? 'star.lit' : state === 'unlit' ? 'star.unlit' : 'star.unknown',
          locale,
        );
        return (
          <Row
            key={key}
            title={`${starGlyph(state)} ${name}`}
            value={stateWord}
            accessibilityLabel={`${name}, ${stateWord}`}
            onPress={state === 'unlit' && onStarPress ? () => onStarPress(key) : undefined}
          />
        );
      })}
    </RowGroup>
  );
}
