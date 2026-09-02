import { Pressable, Text, cn } from '@/tw';

/**
 * Interactive selection chip (DESIGN.md §8 toggle). selected = cyan-accent fill
 * (aura-soft bg + aura-line border), idle = hairline-bordered raised surface.
 * `small` is the compact variant for visibility rows — and the only one that
 * carries the 44pt floor (DESIGN §10), so a compact chip row must pass it.
 * Mirrors the onboarding inline chip.
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
  small = false,
  role = 'button',
  className,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  small?: boolean;
  role?: 'button' | 'radio';
  className?: string;
}) {
  return (
    <Pressable
      className={cn(
        'rounded-full border',
        selected ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise-2',
        small ? 'px-3 py-1.5 min-h-[44px] justify-center' : 'px-5 py-3',
        className,
      )}
      onPress={onPress}
      accessibilityRole={role}
      // Both flags, deliberately: `checked` is what a radio announces and `selected` is what a
      // button announces, and a chip is read through whichever its container implies.
      accessibilityState={role === 'radio' ? { checked: selected, selected } : { selected }}
      accessibilityLabel={label}
    >
      <Text className={cn(small && 'text-xs', 'text-foreground', selected && 'font-semibold')}>
        {label}
      </Text>
    </Pressable>
  );
}
