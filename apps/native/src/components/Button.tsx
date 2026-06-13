import { Pressable, Text } from '@/tw';

/**
 * Primary (avorio) / ghost (hairline) action button. Mirrors apps/web ui/button.tsx
 * and the onboarding primary button. Gold (oro) is a moment, never a default action.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  if (variant === 'primary') {
    return (
      <Pressable
        className={
          disabled
            ? 'h-[52px] items-center justify-center rounded-full bg-avorio px-6 opacity-40'
            : 'h-[52px] items-center justify-center rounded-full bg-avorio px-6'
        }
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
      >
        <Text className="font-semibold tracking-widest text-blu-notte">{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      className={
        disabled
          ? 'h-[52px] items-center justify-center rounded-full border border-line px-6 opacity-40'
          : 'h-[52px] items-center justify-center rounded-full border border-line px-6'
      }
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text className="tracking-widest text-foreground">{label}</Text>
    </Pressable>
  );
}
