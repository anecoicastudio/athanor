import { Pressable, Text } from '@/tw';
import { auraGlow } from '@/lib/glow';

/**
 * Primary (foreground) / ghost (hairline) / light (aura cyan) action button.
 * Mirrors apps/web ui/button.tsx and the onboarding primary button.
 * Aura (the star) is a moment, never a default action — use `light` only for
 * moment-grade CTAs.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'light';
  disabled?: boolean;
}) {
  const base = 'h-[52px] items-center justify-center rounded-full px-6';
  if (variant === 'light') {
    return (
      <Pressable
        className={`${base} bg-aura ${disabled ? 'opacity-40' : ''}`}
        style={disabled ? undefined : auraGlow(1)}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
      >
        <Text className="font-semibold tracking-widest text-on-aura">{label}</Text>
      </Pressable>
    );
  }
  if (variant === 'primary') {
    return (
      <Pressable
        className={`${base} bg-foreground ${disabled ? 'opacity-40' : ''}`}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
      >
        <Text className="font-semibold tracking-widest text-background">{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      className={`${base} border border-hair ${disabled ? 'opacity-40' : ''}`}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text className="tracking-widest text-foreground">{label}</Text>
    </Pressable>
  );
}
