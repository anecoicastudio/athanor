import { Pressable, Text, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';

/**
 * 6 above and below take the 32pt pill to a 44pt target; 4 on each side do the same for a
 * chip as narrow as «IT» (42pt). The numbers are the prototype's.
 */
const CHIP_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

/**
 * The selection chip (DESIGN §9 Chip, Galleria since 2026-10-04, #921): a hairline pill with no
 * fill and a 14px foreground label. Selected, it fills with the foreground and its label takes
 * the background — white, never `aura`: rule 4 keeps cyan off every selected state, and
 * `source-audit.test.ts` section 50 holds this file to it. There is one size. The `small` arm
 * is gone: it differed in padding and type only, and Galleria draws one chip.
 *
 * It is 32pt tall and its TARGET is 44. DESIGN §10's floor is a property of a tap target, not
 * of a drawing (#635), so `hitSlop` makes up the difference. `min-h`, not `h`: the label
 * scales with the member's text size and the pill grows with it. Measured on 2026-10-04:
 *
 *   - iPhone SE simulator (iOS 26.3, Expo Go): 32pt at the default text size, 46.5 at the
 *     largest. In a wrapping group, a tap 5pt above the top edge of a chip in the first row
 *     selected it, so did one 5pt below a chip in the last row, and one 8pt above did not.
 *   - moto g17 (Android 15, dev client): 32dp at a font scale of 1.0, 44 at 2.0. The same three
 *     taps gave the same three answers, so the slop reaches past the group's own box there too.
 *
 * Pressed, it dims to 0.6 (DESIGN §10): `PRESS_DIM` from `lib/press.ts`, in the class list
 * from the first render (that file says why it is never conditional). Held on both devices
 * that day, the label's white fell from 245 to 147 in the screenshot.
 *
 * `role` is the a11y contract, not a second look. A chip inside a container that
 * declares `accessibilityRole="radiogroup"` is a RADIO — VoiceOver announces
 * «selezionato» for a button's `selected` but «spuntato» for a radio's `checked`,
 * and a radio inside a radiogroup is the only pairing that also says "1 di 5"
 * (#635). Default stays `button`: most call sites are multi-select or plain
 * filters, so the radio arm is opt-in — it follows the CONTAINER's role, not
 * the chip's own preference.
 *
 * `className` is for LAYOUT only (`flex-1`, `self-start`, `items-center`) —
 * `SectionLabel`'s rule, for the same reason: react-native-css resolves
 * same-specificity conflicts by source order, so overriding the fill, the border
 * or the radius through it is not something to rely on.
 */
export function Chip({
  label,
  selected,
  onPress,
  role = 'button',
  className,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'button' | 'radio';
  className?: string;
}) {
  return (
    <Pressable
      className={cn(
        'min-h-[32px] justify-center rounded-full border px-[14px] py-1',
        selected ? 'border-foreground bg-foreground' : 'border-hair',
        PRESS_DIM,
        className,
      )}
      hitSlop={CHIP_SLOP}
      onPress={onPress}
      accessibilityRole={role}
      // Both flags, deliberately: `checked` is what a radio announces and `selected` is what a
      // button announces, and a chip is read through whichever its container implies.
      accessibilityState={role === 'radio' ? { checked: selected, selected } : { selected }}
      accessibilityLabel={label}
    >
      <Text
        className={cn('text-center text-[14px]', selected ? 'text-background' : 'text-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  );
}
