import { Pressable, Text, cn } from '@/tw';

/**
 * Interactive selection chip (DESIGN.md §8 toggle). selected = cyan-accent fill
 * (aura-soft bg + aura-line border), idle = hairline-bordered raised surface.
 * `small` is the compact variant for visibility rows.
 * Mirrors the onboarding inline chip.
 */
export function Chip({
  label,
  selected,
  onPress,
  small = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  small?: boolean;
}) {
  return (
    <Pressable
      className={cn(
        'rounded-full border',
        selected ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise-2',
        small ? 'px-3 py-1.5 min-h-[44px] justify-center' : 'px-5 py-3',
      )}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text className={cn(small && 'text-xs', 'text-foreground', selected && 'font-semibold')}>
        {label}
      </Text>
    </Pressable>
  );
}
