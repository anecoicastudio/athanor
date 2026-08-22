import { useState } from 'react';
import { semantic } from '@athanor/config';
import { View, Text, TextInput, cn, type TextInputProps } from '@/tw';

/**
 * The one BLOCK text field — the `rounded-hero` sibling of `Input`'s pill.
 *
 * DESIGN §9 documents a single input shape, the pill (radius full), and `Input` implements it.
 * The app ships a SECOND shape that §9 never described: radius `hero` (26 — "hero blocks, media,
 * sheet tops"), the field that sits as a block in a sheet or a form, under a `SectionLabel` and
 * over a hint. Twelve of them, spelled by hand. Everything except the radius comes from that §9
 * Input row: `raise` bg (#498), hairline border, foreground text, placeholder `foregroundMuted`,
 * focus = foreground ring 1px, error = `error` ring + caption below.
 *
 * The census on `dev` @ b94fd10 found all twelve sharing `rounded-hero border bg-raise px-5 py-4
 * text-foreground` exactly, and diverging on four axes. Three were drift, one was meaning:
 *
 * (The family is really fifteen. The three compose screens — story, post, project — are the same
 * shape with their own padding and type, and #499 did not count them because they already pass
 * the placeholder prop it was filed about. They are named in `source-audit.test.ts` §15 with the
 * reason they have not been routed here yet.)
 *
 * ── WHY TWO SIZES AND NOT THREE ───────────────────────────────────────────────────────────
 * `min-h-36` ×2, `min-h-32` ×2, `min-h-28` ×3. Only one boundary is a design decision: whether
 * the field IS the screen (the dream, the help message, the candidacy prose — the step exists to
 * hold it) or is one field among several (the report's optional note, the profile's bio and
 * mission). 36-vs-32 draws no such line, so it collapses.
 *
 * - `md` (default) — a field among fields. `min-h-28`.
 * - `lg` — the field the screen is about. `min-h-36`.
 *
 * A single-line field takes neither: `size` applies only when `multiline` is set, because
 * without it there is no box to give a floor to.
 *
 * ── WHY ONE TEXT SIZE ─────────────────────────────────────────────────────────────────────
 * Eight of the twelve set `text-lg`; four set nothing at all (`CityPicker`, and `ProfileEditForm`'s
 * name/bio/mission), so their text rendered at whatever size the PLATFORM defaults a `TextInput`
 * to — the same failure as the placeholder colour this primitive exists to fix, one axis over.
 * The majority spelling wins and the four join it. Note 15pt (`Input`) and 18pt (here) are both
 * off §4's mobile scale, which has no step between body 16 and h2 20; reconciling the two input
 * families against that scale is a separate question and is NOT settled here.
 *
 * ── WHY `register` IS A PROP AND `font-dream` IS NOT A CLASS ───────────────────────────────
 * Three fields carry `font-dream` and all three hold a dream (§4: the italic register is the
 * dream voice, never decoration). That is meaning, not drift, so it survives as a named prop —
 * which also makes "which fields are dream-register?" a grep rather than a reading.
 *
 * ── WHY A FOCUS RING APPEARS THAT NO CALL SITE HAD ────────────────────────────────────────
 * None of the twelve implemented one, while §9 specifies `focus = foreground ring 1px` and
 * `Input` has it. Twelve-for-twelve absence is uniform drift, not a decision — the documented
 * recipe ships. `error` outranks `focus`: an errored field stays red while you fix it.
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
 */
type Size = 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  md: 'min-h-28',
  lg: 'min-h-36',
};

export type FieldProps = Omit<TextInputProps, 'placeholderTextColor'> & {
  size?: Size;
  register?: 'app' | 'dream';
  /** The caption to render under the field. Truthy also lights the `error` ring. */
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
    <View className="gap-2">
      <TextInput
        className={cn(
          'rounded-hero border bg-raise px-5 py-4 text-lg text-foreground',
          multiline && SIZE_CLASSES[size],
          register === 'dream' && 'font-dream',
          error ? 'border-error' : focused ? 'border-foreground' : 'border-hair',
          className,
        )}
        multiline={multiline}
        // Android-only, and only meaningful on a box: without it a multiline TextInput centers
        // its text vertically, so a half-empty field floats its first line in the middle. iOS
        // already starts at the top. The three compose screens set it by hand for this same
        // shape; here it comes with the shape. Before `rest`, so a caller can still override.
        textAlignVertical={multiline ? 'top' : undefined}
        placeholderTextColor={semantic.foregroundMuted}
        {...rest}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {error ? <Text className="text-sm text-error">{error}</Text> : null}
    </View>
  );
}
