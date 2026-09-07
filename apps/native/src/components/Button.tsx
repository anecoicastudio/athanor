import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { semantic } from '@athanor/config';
import { Pressable, Text, View, cn } from '@/tw';
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
 *
 * `icon` is an optional leading slot (#539), today used only by the two OAuth provider CTAs
 * for their vendor brand marks. It is ABSOLUTELY POSITIONED in a reserved left gutter rather
 * than laid out in a row with the label, and that is the whole design:
 *
 *   - a row would centre the [mark · label] PAIR, moving the label's optical centre right by
 *     half the mark's width — visible as a wobble against the email CTA directly below it on
 *     `welcome.tsx`, which has no icon. The gutter is mirrored on the right, so the label
 *     stays centred in the pill exactly as it is today;
 *   - the mark cannot collide with a long label, because the label's box starts after the
 *     gutter rather than merely being pushed by it;
 *   - #639's wrap geometry is untouched — the container keeps `min-h` and its column axis, so
 *     a label that wraps at AX sizes still grows the pill, and the mark stays vertically
 *     centred against the taller pill for free (`bottom-0 top-0 justify-center`).
 *
 * A caller that renders nothing must pass `null`, not an element that returns null: this
 * component reserves the gutter for any element it is handed and cannot see what that element
 * resolved to. `providerMark()` is written that way for exactly this reason.
 *
 * The cost of keying the gutter per BUTTON rather than per group, named because it is one: two
 * stacked pills stretch to the same width, so one with an icon gives its label 64pt less room
 * than one without. Stacked provider CTAs can therefore reach the wrap point at different text
 * scales and stand at different heights — «Continua con Google» wraps around 1.4× while
 * «Continua con Apple» has not. Legible rather than broken (#639's `min-h` is what makes it
 * grow instead of clip), and the alternative — a gutter the caller reserves across a group —
 * buys symmetry with an API nothing else here needs.
 *
 * `left-6`, not `start-6`: React Native flips `start`/`end` under `I18nManager.isRTL` and never
 * `left`/`right`, so under an RTL locale the pill would mirror and the mark would not. The
 * catalogs are IT/EN, so this cannot bite today; it is the line to change if RTL is ever on.
 *
 * The mark is hidden while `loading` — the spinner has already replaced the label, and a
 * brand mark beside a spinner reads as a second, stalled control.
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
  icon = null,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Spinner in place of the label. Implies `disabled` — a busy control is not pressable. */
  loading?: boolean;
  glow?: boolean;
  /**
   * Leading mark, in a reserved gutter that leaves the label centred. Decorative only — the
   * control is named by `accessibilityLabel ?? label`, so the node must hide itself from
   * assistive tech. Pass `null`, never an element that renders null (see the docblock).
   */
  icon?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { container, text, ink } = VARIANT_CLASSES[variant];
  const inert = disabled || loading;
  // Hidden while busy, so the gutter is reserved only when something is actually drawn in it.
  const mark = loading ? null : icon;
  return (
    <Pressable
      className={cn(
        // `min-h`, not `h` (#639): a label that wraps at AX sizes — «Entra nel Circle ·
        // 12,00 €/mese» is the long one, and grew by four characters when #644 started
        // rendering the live amount through `formatPrice` — grows the pill instead of
        // clipping inside it. `py` is what a wrapped label breathes on; at the default size
        // the 52pt floor still wins, so nothing moves. DESIGN §9 measures the pill, and a
        // floor still measures it.
        'min-h-[52px] items-center justify-center rounded-full py-3',
        // The gutter is keyed on `icon`, not on what is currently drawn, so the padding does
        // not change when `loading` swaps the mark out from under a fixed-width pill.
        icon ? 'px-14' : 'px-6',
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
      {mark ? (
        // `left-6` puts the mark where a no-icon label would have started, inside the 56pt
        // gutter `px-14` reserves on both sides.
        <View className="absolute bottom-0 left-6 top-0 justify-center">{mark}</View>
      ) : null}
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Text className={cn('text-center text-[13px] font-semibold tracking-[0.14em]', text)}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
