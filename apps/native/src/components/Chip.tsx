import { Pressable, Text } from '@/tw';

/**
 * Interactive selection chip (DESIGN.md §8 toggle). selected = luce/notte,
 * idle = hairline-bordered. `small` is the compact variant for visibility rows.
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
  return (
    <Pressable
      className={
        selected
          ? small
            ? 'rounded-full bg-luce px-3 py-1.5'
            : 'rounded-full bg-luce px-5 py-3'
          : small
            ? 'rounded-full border border-line bg-surface px-3 py-1.5'
            : 'rounded-full border border-line bg-surface px-5 py-3'
      }
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        className={
          selected
            ? small
              ? 'text-xs font-semibold text-notte'
              : 'font-semibold text-notte'
            : small
              ? 'text-xs text-foreground'
              : 'text-foreground'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
