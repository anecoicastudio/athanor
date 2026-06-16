import { Pressable, Text } from '@/tw';

/**
 * Round swipe-action button (frontend §9) — the button parity for the gesture (a11y).
 * «Passa» = neutral raised surface, «Connetti ✦» = flat aura fill (NO glow — glow is
 * reserved for the match overlay, rule #4). ≥44pt tap target.
 */
export function SwipeActionButton({
  variant,
  label,
  a11yLabel,
  onPress,
  disabled,
}: {
  variant: 'pass' | 'connect';
  label: string;
  a11yLabel: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const connect = variant === 'connect';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      className={`min-h-[56px] min-w-[56px] flex-1 items-center justify-center rounded-full border px-6 py-4 ${
        connect ? 'border-aura-line bg-aura' : 'border-hair bg-raise'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className={`text-[15px] font-semibold ${connect ? 'text-on-aura' : 'text-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
