import { cn, Text, View } from '@/tw';

/**
 * Static read-mode tag — a fact, not a control. Quiet hairline pill.
 *
 * Two jobs, two tones. The default (`text-foreground`) is for tags that ARE the payload of
 * their section — the identity/seeking tags under a SectionLabel on Profilo. `quiet`
 * (`text-muted-foreground`) is for tags that ANNOTATE something else: they must never outrank
 * the content they label. Passing the wrong one inverts the row's hierarchy — a metadata pill
 * reading brighter than the dream/message/title it sits beside.
 *
 * `quiet` is `muted-foreground`, NOT `faint`, and the reason is compositing: this pill's
 * `bg-raise-2` usually sits inside a `bg-raise` row (SuggestionRow, IncomingOfferRow), so the
 * backdrop is raise-2 OVER raise over the canvas = ~rgb(35,35,49) — not the bare-canvas stack
 * the 4.69:1 figure in tokens.ts certifies. `faint` on the nested stack is 4.22:1, under the
 * 4.5 floor for 13px text. `muted-foreground` is 5.79:1 there (6.43:1 on the bare-canvas
 * geometry BenefitRow has) and still a clear step below the `ink-2` payload beside it.
 *
 * `shrink` is for a pill sharing a `flex-row` with the row's payload, where the label is not a
 * short fixed string. React Native defaults `flexShrink` to **0**, so a wide pill takes its full
 * intrinsic width and the `flex-1` column beside it absorbs the whole deficit — «Potrebbe cercare
 * ciò che offri» next to a name would leave the name nothing.
 *
 * The cap lives HERE, on the pill, and not as a `min-w` floor on the payload column. That floor
 * was tried and is wrong: the payload is `flex-1`, i.e. basis 0 with grow 1, so it already
 * absorbs every pixel of slack — a floor on top of that pushes it PAST its flex result and the
 * overflow comes out of the pill, which then ellipsizes even a 6-character «Cerchi». Capping the
 * pill leaves the natural layout alone whenever the label fits, and only binds when it does not.
 *
 * Two lines, not one: at this cap the longest prefixes («Potrebbe cercare ciò che offri»,
 * «May be looking for what you offer») wrap and stay READABLE, where a one-line clamp would
 * ellipsize them to nothing useful. The clamp is still there at 2 so a longer future prefix
 * truncates rather than inflating the row.
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
        'rounded-full border border-hair bg-raise-2 px-4 py-1.5',
        shrink && 'max-w-[40%] shrink',
      )}
    >
      <Text
        numberOfLines={shrink ? 2 : undefined}
        className={cn('text-[13px]', quiet ? 'text-muted-foreground' : 'text-foreground')}
      >
        {label}
      </Text>
    </View>
  );
}
