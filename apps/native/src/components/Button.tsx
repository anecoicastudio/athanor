import { Pressable, Text, cn } from '@/tw';
import { auraGlow } from '@/lib/glow';

/**
 * Primary (foreground) / ghost (bare, muted) / light (aura cyan) action button.
 * DESIGN §9: pill h52, label 13/600 letterspaced 0.14em; ghost has no bg/border
 * and reads in foregroundMuted («più tardi», «passa»).
 * Cyan fill is fine on a `light` CTA (rule #4), but the cyan *glow* is reserved
 * for moment-grade events — so `light` is flat by default; pass `glow` only when
 * the press is itself a moment (e.g. a dream igniting).
 */
type Variant = 'primary' | 'ghost' | 'light' | 'danger';

const VARIANT_CLASSES: Record<Variant, { bg: string | false; text: string }> = {
  light: { bg: 'bg-aura', text: 'text-on-aura' },
  primary: { bg: 'bg-foreground', text: 'text-background' },
  danger: { bg: 'bg-error', text: 'text-on-error' },
  ghost: { bg: false, text: 'text-muted-foreground' },
};

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
  variant?: Variant;
  disabled?: boolean;
  glow?: boolean;
  accessibilityLabel?: string;
}) {
  const { bg, text } = VARIANT_CLASSES[variant];
  return (
    <Pressable
      className={cn(
        'h-[52px] items-center justify-center rounded-full px-6',
        bg,
        disabled && 'opacity-40',
      )}
      style={variant === 'light' && glow && !disabled ? auraGlow(1) : undefined}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text className={cn('text-[13px] font-semibold tracking-[0.14em]', text)}>{label}</Text>
    </Pressable>
  );
}
