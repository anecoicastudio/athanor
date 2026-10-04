import { Pressable, View, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';

/** 8 above and below take the 28pt track to a 44pt target; it is 46 wide already. */
const SWITCH_SLOP = { top: 8, bottom: 8 } as const;

/**
 * The app's toggle (DESIGN §9 Switch, #921): a 46×28 pill with a 22pt knob. On, the track is
 * the foreground and the knob the background, at the right; off, the track is a secondary-grey
 * outline and the knob the same grey, at the left. White, never `aura`: rule 4 keeps cyan off
 * every selected state, and `source-audit.test.ts` («grouped rows and the switch») holds this
 * file to it. It replaces the platform `Switch`, which took its colours from each call site and
 * drew a different control on each OS.
 *
 * `accessibilityLabel` is required. The label `Text` beside a toggle is a sibling, not an
 * association, so without it the control announces its state and no subject (#635): pass the
 * same key the visible label renders, so the two cannot drift.
 *
 * It is 28pt tall and its TARGET is 44 (DESIGN §10): `hitSlop` makes up the difference, as on
 * `Chip`. Where the row is the control (the two composers), the switch sits inside a hidden,
 * touch-inert wrapper and only draws the state; it takes no `onValueChange` there.
 *
 * The knob does not travel: the state is a cut, so there is nothing for Reduce Motion to turn
 * off. A disabled switch is inert and looks as it would enabled; the row that locks it says so
 * (`trust.tsx` dims its «never sold» row).
 */
export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      className={cn(
        'h-7 w-[46px] flex-none flex-row items-center rounded-full',
        value ? 'justify-end bg-foreground p-[3px]' : 'border border-muted-foreground p-[2px]',
        PRESS_DIM,
      )}
      hitSlop={SWITCH_SLOP}
      disabled={disabled || !onValueChange}
      onPress={() => onValueChange?.(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      <View
        className={cn(
          'h-[22px] w-[22px] rounded-full',
          value ? 'bg-background' : 'bg-muted-foreground',
        )}
      />
    </Pressable>
  );
}
