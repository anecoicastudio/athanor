import { useState } from 'react';
import { galleria } from '@athanor/config';
import { View, Text, TextInput, cn, type TextInputProps } from '@/tw';
import { useInsideCard } from '@/components/Card';

/**
 * The one form field that stands under a `SectionLabel` (DESIGN §9 Field, Galleria since
 * 2026-10-04, #921). Two shapes, chosen by `multiline`:
 *
 *   - multi-line — the block: radius 24, a min height in two steps (below), body text;
 *   - single-line — a pill, the same one `Input` draws: at least 50pt, radius full.
 *
 * Both fill with `surface` and show no border at rest. The border is there, transparent, so
 * that focus (foreground) and error (`error`, which outranks focus: an errored field stays red
 * while you fix it) colour it without moving the text. The reason of an error is rendered here,
 * under the field, in `error` at 14px — one of the two fixed sizes outside the type scale
 * (DESIGN §4).
 *
 * Before Galleria this was the `rounded-hero` block (radius 26, `raise` fill, a hairline), and
 * a single-line field had the same block shape. It exists because the same field was spelled
 * by hand fifteen times: twelve sharing `rounded-hero border bg-raise px-5 py-4 text-foreground`
 * (the census on `dev` @ b94fd10), plus the three compose screens — story, post, project —
 * which #504's ruling folded in on 2026-08-30. `source-audit.test.ts` §15 names this file as
 * the only place the block is built.
 *
 * ── WHY TWO SIZES AND NOT THREE ───────────────────────────────────────────────────────────
 * `min-h-36` ×2, `min-h-32` ×2, `min-h-28` ×3 was the spread. Only one boundary is a design
 * decision: whether the field IS the screen (the dream, the help message, the candidacy prose
 * — the step exists to hold it) or is one field among several (the report's optional note, the
 * profile's bio and mission). 36-vs-32 draws no such line, so it collapses.
 *
 * - `md` (default) — a field among fields. `min-h-28` (112px). The story
 *   caption, which sits beside the media it annotates.
 * - `lg` — the field the screen is about. `min-h-36` (144px). The dream, the
 *   help message, the candidacy prose, and — since #504 — the post body and the project description.
 *
 * A single-line field takes neither: `size` applies only when `multiline` is set, because
 * without it there is no box to give a floor to.
 *
 * ── THE TEXT: BODY, AND WHY A PILL DOES NOT SAY `type-body` ────────────────────────────────
 * A field's text is body, 17px. A multi-line field takes the `type-body` class, so its lines
 * stand 24 apart like the prose around it. A single-line one writes the size alone,
 * `text-[17px]`: it has no second line to space, and on iOS a line height on a one-line field
 * pushes the text down inside the pill. `Input`'s docblock has the measurement, and the one
 * that makes the vertical padding `pt-`/`pb-` rather than `py-`.
 *
 * ── WHY `register` IS A PROP AND `font-dream` IS NOT A CLASS ───────────────────────────────
 * Three fields hold a dream (§4: the italic register is the dream voice, never decoration).
 * That is meaning, not drift, so it survives as a named prop — which also makes "which fields
 * are dream-register?" a grep rather than a reading. A dream field takes `type-quote`, §4's
 * dream style (18/23 italic), so the words stand in the field as `DreamQuote` will set them.
 * No weight goes beside it (`source-audit.test.ts` section 48).
 *
 * `className` is for LAYOUT — never for re-padding or re-coloring. Two Tailwind paddings on one
 * element resolve by stylesheet source order, not string order, so a caller's `py-3` would win or
 * lose depending on how the sheet was authored. Pick a size instead. Same warning `Input` and
 * `ListState` carry.
 *
 * `placeholderTextColor` is deliberately absent from the prop type: it is the one raw color RN
 * requires as a value rather than a class, and leaving it settable would let the platform grey
 * back in through the very primitive that exists to remove it. `source-audit.test.ts` §15 asserts
 * no `<TextInput>` with a `placeholder` ever ships without one.
 *
 * Measured on 2026-10-04 at the default text size, on an iPhone SE simulator (iOS 26.3, Expo
 * Go) and a moto g17 (Android 15, dev client) alike: a single-line field 50, `md` 112, `lg`
 * 144, and a one-line reason adds about 24 under the field (6 of gap and its line). At the largest
 * text size the simulator gave a single-line field 70.5 and three lines of `md` 170; the phone
 * at a font scale of 2.0 gave a single-line field 64.4.
 */
type Size = 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  md: 'min-h-28',
  lg: 'min-h-36',
};

export type FieldProps = Omit<TextInputProps, 'placeholderTextColor'> & {
  size?: Size;
  register?: 'app' | 'dream';
  /** The reason to render under the field. Truthy also lights the `error` border. */
  error?: string | null | false;
};

export function Field({
  size = 'md',
  register = 'app',
  error,
  multiline,
  className,
  onFocus,
  onBlur,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const insideCard = useInsideCard();

  // Forwarded, not replaced — same reason `Input` forwards them: a caller may be driving
  // something else off focus, and swallowing these would strand it.
  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  // The wrapper is unconditional even with no error. Rendering it only when `error` is set
  // would change the element tree as the error appears and disappears, remounting the
  // TextInput — which drops the keyboard mid-sentence on the two screens that clear their
  // error on the next keystroke.
  return (
    <View className="gap-1.5">
      <TextInput
        className={cn(
          // Physical on both axes, never `px-*` or `py-*`: Android's TextInput drops logical
          // inline padding (#749) and an iOS multi-line one drops logical block padding — see
          // `Input`'s docblock for both measurements.
          'border pb-3 pl-5 pr-5 pt-3 text-foreground',
          // Inside a `Card` the field's own fill is the card's and the field would vanish at rest;
          // there it is a black well (`useInsideCard`, #921 2026-10-04).
          insideCard ? 'bg-background' : 'bg-surface',
          multiline ? cn('rounded-[24px]', SIZE_CLASSES[size]) : 'min-h-[50px] rounded-full',
          register === 'dream' ? 'type-quote' : multiline ? 'type-body' : 'text-[17px]',
          error ? 'border-error' : focused ? 'border-foreground' : 'border-transparent',
          className,
        )}
        multiline={multiline}
        // Android-only, and only meaningful on a box: without it a multiline TextInput centers
        // its text vertically, so a half-empty field floats its first line in the middle. iOS
        // already starts at the top. The three compose screens each set it by hand until #504
        // routed them here; now it comes with the shape. Before `rest`, so a caller can still
        // override.
        textAlignVertical={multiline ? 'top' : undefined}
        placeholderTextColor={galleria.foregroundMuted}
        {...rest}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {error ? <Text className="text-[14px] text-error">{error}</Text> : null}
    </View>
  );
}
