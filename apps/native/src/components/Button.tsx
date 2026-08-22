import { ActivityIndicator } from 'react-native';
import { semantic } from '@athanor/config';
import { Pressable, Text, cn } from '@/tw';
import { auraGlow } from '@/lib/glow';

/**
 * Primary (foreground) / ghost (bare, muted) / light (aura cyan) / outline (quiet,
 * bordered) / danger action button.
 * DESIGN §9: pill h52, label 13/600 letterspaced 0.14em; ghost has no bg/border
 * and reads in foregroundMuted («più tardi», «passa»).
 * Cyan fill is fine on a `light` CTA (rule #4), but the cyan *glow* is reserved
 * for moment-grade events — so `light` is flat by default; pass `glow` only when
 * the press is itself a moment (e.g. a dream igniting).
 *
 * Every filled variant is DARK INK ON A LIGHT FILL: `light` = onAura on cyan, `primary` =
 * background on foreground, `danger` = onError on error. `danger` used to be the odd one out
 * with a near-white label, which is also how it shipped at 3.44:1 on the account-deletion CTA.
 *
 * `outline` is the quiet secondary — a hairline over `raise`, foreground label. It had been
 * copy-pasted verbatim into `[handle].tsx`, `+not-found.tsx` and `auth-callback.tsx`, and
 * again (at `h-[52px]`) for the two OAuth buttons on `welcome.tsx`. It is NOT a moment
 * surface: the framed cyan pill (`border-aura-line bg-aura-soft`) stays reserved for
 * moment-grade events, and "go home" is not one.
 *
 * `loading` swaps the label for a spinner in the variant's own ink and marks the control
 * busy for assistive tech. It implies `disabled`, so a press cannot be queued behind a
 * request that is already in flight — that is why `welcome.tsx` forked this component three
 * times rather than using it.
 */
type Variant = 'primary' | 'ghost' | 'light' | 'danger' | 'outline';

const VARIANT_CLASSES: Record<Variant, { container: string | false; text: string; ink: string }> = {
  light: { container: 'bg-aura', text: 'text-on-aura', ink: semantic.onAura },
  primary: { container: 'bg-foreground', text: 'text-background', ink: semantic.background },
  danger: { container: 'bg-error', text: 'text-on-error', ink: semantic.onError },
  outline: {
    container: 'border border-hair bg-raise',
    text: 'text-foreground',
    ink: semantic.foreground,
  },
  ghost: { container: false, text: 'text-muted-foreground', ink: semantic.foregroundMuted },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  glow = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Spinner in place of the label. Implies `disabled` — a busy control is not pressable. */
  loading?: boolean;
  glow?: boolean;
  accessibilityLabel?: string;
}) {
  const { container, text, ink } = VARIANT_CLASSES[variant];
  const inert = disabled || loading;
  return (
    <Pressable
      className={cn(
        'h-[52px] items-center justify-center rounded-full px-6',
        container,
        inert && 'opacity-40',
      )}
      style={variant === 'light' && glow && !inert ? auraGlow(1) : undefined}
      disabled={inert}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Text className={cn('text-[13px] font-semibold tracking-[0.14em]', text)}>{label}</Text>
      )}
    </Pressable>
  );
}
