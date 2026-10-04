import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { galleria } from '@athanor/config';
import { Pressable, Text, View, cn } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { PRESS_DIM, pillPress } from '@/lib/press';

/**
 * The app's button (DESIGN §9, Galleria since 2026-10-04, #921). Five pills and a link:
 *
 *   - `primary` — the white pill: foreground fill, background label. The primary action
 *     everywhere, an action that makes a moment included (accepting a Momento, contributing).
 *   - `celebration` — the cyan pill: `aura` fill, `onAura` label. On the five celebration
 *     screens and nowhere else (match, new level, favour done, candidacy sent, contribution
 *     thanks): rule 4 keeps cyan off every action, and `source-audit.test.ts` section 47 holds
 *     both the list of screens and this table to it.
 *   - `outline` — no fill, a 1px `foregroundMuted` border, foreground label: the second action
 *     beside a primary, and the «go home» of a dead end.
 *   - `destructive` — the same outline in `error`, border and label. It replaced the filled
 *     `danger` button.
 *   - `ghost` — not a pill: a text link, 15px, foreground, underlined, in a 44pt target.
 *     «più tardi», «Annulla».
 *   - `apple` — the one platform-mandated exception: Apple's HIG requires its own
 *     white-fill/black-ink Sign in with Apple button (ruled 2026-09-19 on #79). It serves
 *     exactly one call site, the Apple CTA on `welcome.tsx` — never reach for it elsewhere.
 *
 * A pill is at least 50pt tall and its label is `type-body` at 600: 17px, no tracking.
 * `size="sm"` is the small pill, at least 44pt — the tap-target floor itself — with a 14px
 * label, one of the two fixed sizes outside the type scale (DESIGN §4). The link has one size
 * and ignores `size`. Measured on 2026-10-04 at the default text size, on an iPhone SE
 * simulator and a moto g17 alike: a pill 50, a small pill 44, the link 44. At the largest text
 * size the simulator gave a one-line pill 72, a small pill 52.5 (54.5 with a border) and the
 * link 58. The phone at a font scale of 2.0 gave a pill 60 and the link 51: Android grew a
 * label of this size by less than two there (the pill label's 24pt line became 36).
 *
 * Nothing here glows, and nothing is cyan but `celebration`. Pressed (DESIGN §10), a pill dims
 * to 0.6 and scales to 0.98, and under Reduce Motion it only dims; the link only dims. Both
 * come from `lib/press.ts`. Disabled is 40%.
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
 * stacked pills stretch to the same width, so one with an icon gives its label 64px less room
 * than one without (`px-14` against `px-6`, both sides). Stacked provider CTAs can therefore
 * reach the wrap point at different text scales and stand at different heights. On an iPhone
 * SE simulator on 2026-10-04 the Apple and Google pills each took one line at the default size
 * and two at the largest (120pt and 122pt). Legible rather than broken (#639's `min-h` is what
 * makes it grow instead of clip), and the alternative — a gutter the caller reserves across a
 * group — buys symmetry with an API nothing else here needs.
 *
 * `left-6`, not `start-6`: React Native flips `start`/`end` under `I18nManager.isRTL` and never
 * `left`/`right`, so under an RTL locale the pill would mirror and the mark would not. The
 * catalogs are IT/EN, so this cannot bite today; it is the line to change if RTL is ever on.
 *
 * The mark is hidden while `loading` — the spinner has already replaced the label, and a
 * brand mark beside a spinner reads as a second, stalled control.
 *
 * **The label is one line by LAYOUT, not by cap** (#833, Marco's ruling 2026-09-23). DESIGN §10
 * forbids capping text, so nothing here sets `numberOfLines`, shrinks the font or turns off
 * `allowFontScaling`. Pills that sit side by side go in `ButtonRow`, which sizes each pill to its
 * one-line label and wraps the ROW instead; `source-audit` §43 fails the `flex-1` cell that used
 * to hand a pill a fixed share and break «Accetta» mid-word. The label that still wraps inside
 * its own pill is a lone full-width one wider than the screen at the member's text size, which
 * has no row to drop to: the pill grows with it. «Fai accadere questo sogno» took two lines and
 * 120pt at the largest text size on an iPhone SE simulator (2026-10-04).
 */
type Variant = 'primary' | 'celebration' | 'outline' | 'destructive' | 'ghost' | 'apple';

const VARIANT_CLASSES: Record<Variant, { container: string | false; text: string; ink: string }> = {
  primary: { container: 'bg-foreground', text: 'text-background', ink: galleria.background },
  celebration: { container: 'bg-aura', text: 'text-on-aura', ink: galleria.onAura },
  outline: {
    container: 'border border-muted-foreground',
    text: 'text-foreground',
    ink: galleria.foreground,
  },
  destructive: { container: 'border border-error', text: 'text-error', ink: galleria.error },
  ghost: { container: false, text: 'text-foreground', ink: galleria.foreground },
  apple: {
    container: 'bg-apple-button-bg',
    text: 'text-apple-button-ink',
    ink: galleria.appleButtonInk,
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon = null,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** `sm` is the small pill (44pt floor, 14px label). The `ghost` link has one size. */
  size?: 'md' | 'sm';
  disabled?: boolean;
  /** Spinner in place of the label. Implies `disabled` — a busy control is not pressable. */
  loading?: boolean;
  /**
   * Leading mark, in a reserved gutter that leaves the label centred. Decorative only — the
   * control is named by `accessibilityLabel ?? label`, so the node must hide itself from
   * assistive tech. Pass `null`, never an element that renders null (see the docblock).
   */
  icon?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { container, text, ink } = VARIANT_CLASSES[variant];
  const reduceMotion = useReducedMotion();
  const inert = disabled || loading;
  const link = variant === 'ghost';
  const small = size === 'sm' && !link;
  // Hidden while busy, so the gutter is reserved only when something is actually drawn in it.
  const mark = loading ? null : icon;
  return (
    <Pressable
      className={cn(
        'items-center justify-center',
        // `min-h`, not `h` (#639): a label that wraps — a LONE full-width pill wider than the
        // screen at the member's text size — grows the pill instead of clipping inside it.
        // Side-by-side pills never wrap their label: `ButtonRow` wraps the row (#833). `py` is
        // what a wrapped label breathes on; at the default size the floor still wins (a 24pt
        // line and 24 of padding under the 50pt floor), so nothing moves. The small pill and
        // the link take `py-2`: with `py-3` a bordered small pill measured 44.5 on an iPhone SE
        // simulator (2026-10-04), half a point over its own floor.
        link
          ? 'min-h-[44px] py-2'
          : small
            ? 'min-h-[44px] rounded-full py-2'
            : 'min-h-[50px] rounded-full py-3',
        // The gutter is keyed on `icon`, not on what is currently drawn, so the padding does
        // not change when `loading` swaps the mark out from under a fixed-width pill.
        icon ? 'px-14' : small ? 'px-[18px]' : 'px-6',
        container,
        link ? PRESS_DIM : pillPress(reduceMotion),
        inert && 'opacity-40',
      )}
      disabled={inert}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
    >
      {mark ? (
        // `left-6` puts the mark where a no-icon label would have started, inside the gutter
        // `px-14` reserves on both sides (56px). It tracks `px-6` step for step, so the
        // mirrored-gutter property holds whatever a step measures, without a second number.
        <View className="absolute bottom-0 left-6 top-0 justify-center">{mark}</View>
      ) : null}
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Text
          className={cn(
            'text-center',
            // A type class owns size, line height and tracking: no utility for any of them may
            // sit beside it (`source-audit.test.ts` section 48). 14 is not in the scale, so the
            // small pill writes it out. The underline is the link's shape, so it sits here and
            // not in the colour table.
            link
              ? 'type-small underline'
              : small
                ? 'text-[14px] font-semibold'
                : 'type-body font-semibold',
            text,
          )}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
