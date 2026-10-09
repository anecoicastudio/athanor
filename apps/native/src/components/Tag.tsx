import { cn, Text, View } from '@/tw';
import { wordLines } from '@/lib/word-lines';

/**
 * Static read-mode tag — a fact, not a control. It draws the chip's pill (DESIGN §9 Chip): a
 * hairline, no fill, a 14px label, at least 32pt tall. The prototype has one rule for both,
 * `.chip`, and draws a tag as a chip that is not selected. What makes this one a tag is that
 * nothing presses it, so it has no target and no pressed state.
 *
 * Two jobs, two tones. The default (`text-foreground`) is for tags that ARE the payload of
 * their section — the identity/seeking tags under a SectionLabel on Profilo. `quiet`
 * (`text-muted-foreground`) is for tags that ANNOTATE something else: they must never outrank
 * the content they label. Passing the wrong one inverts the row's hierarchy — a metadata pill
 * reading brighter than the dream/message/title it sits beside.
 *
 * No fill, and that is what makes `quiet` readable. Until 2026-10-04 the pill filled with
 * `raise-2`, on which the secondary grey is 3.85:1. With nothing behind the label, the grey
 * reads on whatever the tag stands on: the stage (5.80:1, `BenefitRow`) or a charcoal row
 * (4.65:1, `SuggestionRow`), both above the 4.5 floor.
 * `lib/contrast.test.ts` pins the pair and `source-audit.test.ts` section 50 keeps a fill from
 * coming back. No quiet tag stands on an `aura-soft` surface inside a card, where the same
 * grey is 3.85 again.
 *
 * `shrink` is for a pill sharing a `flex-row` with the row's payload, where the label is not a
 * short fixed string. React Native defaults `flexShrink` to **0**, so a wide pill takes its full
 * intrinsic width and the `flex-1` column beside it absorbs the whole deficit — «Avete già
 * condiviso» next to a name would leave the name nothing.
 *
 * The cap lives HERE, on the pill, and not as a `min-w` floor on the payload column. That floor
 * was tried and is wrong: the payload is `flex-1`, i.e. basis 0 with grow 1, so it already
 * absorbs every pixel of slack — a floor on top of that pushes it PAST its flex result and the
 * overflow comes out of the pill, which then ellipsizes even a 6-character «Cerchi». Capping the
 * pill leaves the natural layout alone whenever the label fits, and only binds when it does not.
 *
 * Two lines for a label of two words or more, one for a lone word (`wordLines`, #754): a word
 * wider than the pill would otherwise break in the middle. The cap is 40% of the row and does
 * not widen: the pixels would come out of the member's name (#526, ruled 2026-08-30), so a
 * label that overflows is fixed in the copy. At 14px the EN label "You've already shared" took
 * a third line on an iPhone SE simulator (375pt wide, default text size, 2026-10-04) and became
 * "You've shared" that day, Marco's choice. The other fifteen `momenti.reason.chip.*` labels
 * (IT and EN) took at most two lines there in a `SuggestionRow`-shaped row. A longer future
 * label truncates rather than inflating the row.
 *
 * Opt-in rather than the default: the wrap containers on Profilo want tags at their natural
 * width, and a cap there would break a long identity tag that currently sizes to its content.
 */
export function Tag({
  label,
  quiet = false,
  shrink = false,
}: {
  label: string;
  quiet?: boolean;
  shrink?: boolean;
}) {
  return (
    <View
      className={cn(
        'min-h-[32px] justify-center rounded-full border border-hair px-[14px] py-1',
        shrink && 'max-w-[40%] shrink',
      )}
    >
      <Text
        numberOfLines={shrink ? wordLines(label) : undefined}
        className={cn('text-[14px]', quiet ? 'text-muted-foreground' : 'text-foreground')}
      >
        {label}
      </Text>
    </View>
  );
}
