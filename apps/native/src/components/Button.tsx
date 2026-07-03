import { Pressable, Text } from '@/tw';
import { auraGlow } from '@/lib/glow';

/**
 * Primary (foreground) / ghost (bare, muted) / light (aura cyan) action button.
 * DESIGN §9: pill h52, label 13/600 letterspaced 0.14em; ghost has no bg/border
 * and reads in foregroundMuted («più tardi», «passa»).
 * Cyan fill is fine on a `light` CTA (rule #4), but the cyan *glow* is reserved
 * for moment-grade events — so `light` is flat by default; pass `glow` only when
 * the press is itself a moment (e.g. a dream igniting).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  glow = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'light' | 'danger';
  disabled?: boolean;
  glow?: boolean;
  accessibilityLabel?: string;
}) {
  const base = 'h-[52px] items-center justify-center rounded-full px-6';
  if (variant === 'light') {
    return (
      <Pressable
        className={`${base} bg-aura ${disabled ? 'opacity-40' : ''}`}
        style={glow && !disabled ? auraGlow(1) : undefined}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Text className="text-[13px] font-semibold tracking-[0.14em] text-on-aura">{label}</Text>
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
        accessibilityLabel={accessibilityLabel}
      >
        <Text className="text-[13px] font-semibold tracking-[0.14em] text-background">{label}</Text>
      </Pressable>
    );
  }
  if (variant === 'danger') {
    return (
      <Pressable
        className={`${base} bg-error ${disabled ? 'opacity-40' : ''}`}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Text className="text-[13px] font-semibold tracking-[0.14em] text-on-error">{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      className={`${base} ${disabled ? 'opacity-40' : ''}`}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text className="text-[13px] font-semibold tracking-[0.14em] text-muted-foreground">{label}</Text>
    </Pressable>
  );
}
