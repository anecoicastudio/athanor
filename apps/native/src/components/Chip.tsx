import { Pressable, Text } from '@/tw';

/**
 * Interactive selection chip (DESIGN.md §8 toggle). selected = cyan-accent fill
 * (aura-soft bg + aura-line border), idle = hairline-bordered raised surface.
 * `small` is the compact variant for visibility rows.
 * Mirrors apps/web components/chip.tsx and the onboarding inline chip.
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
  const pad = small ? 'px-3 py-1.5' : 'px-5 py-3';
  const text = small ? 'text-xs' : '';
  return (
    <Pressable
      className={
        selected
          ? `rounded-full border border-aura-line bg-aura-soft ${pad}`
          : `rounded-full border border-hair bg-raise-2 ${pad}`
      }
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text className={`${text} ${selected ? 'font-semibold text-foreground' : 'text-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
