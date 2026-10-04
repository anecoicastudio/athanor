import { useEffect, useRef, useState, type ReactNode } from 'react';
import { galleria } from '@athanor/config';
import { Pressable, TextInput, View, cn, type TextInputProps } from '@/tw';

/**
 * The one pill text field (DESIGN §9 Input, Galleria since 2026-10-04, #921): radius full, a
 * `surface` fill, no border at rest, foreground text at 17px, placeholder `foregroundMuted`.
 * Focus draws a 1px foreground border and `invalid` a 1px `error` one, which outranks focus.
 * The border is always there, transparent at rest, so neither state moves the text.
 *
 * It exists because the same field was spelled nine different ways. The census on
 * `dev` @ 78d4ad7 found these paddings on the SAME `rounded-full border border-hair
 * bg-raise` recipe: `p-5` ×6, `px-5 py-4` ×3, `px-5 py-3` ×2, `px-5 py-3.5`, `p-4`,
 * `px-4 py-3`, `px-4 py-2` ×3 — plus 16 of the 40 `<TextInput>`s in the app passing no
 * `placeholderTextColor` at all, so their placeholder rendered in the platform grey
 * rather than in a token.
 *
 * ── WHY TWO SIZES AND NOT SIX ─────────────────────────────────────────────────────
 * Only one of those distinctions is a design decision rather than drift:
 *
 * - `md` (default) — a form field on a form screen: at least 50pt, the height of the pill
 *   `Button` it usually stands above. The six form spellings above all collapse here.
 * - `sm` — the compose bar: a `flex-1` field sharing a bottom row with a 44pt send
 *   button (chat, post comments, story replies), so it is at least 44pt. It may be
 *   `multiline`, and its radius is 22 rather than full: at one line that is the same pill,
 *   and a message of several lines stays a rounded box rather than a capsule. A multi-line
 *   FORM field is not this component: use `Field`, which is why `multiline` is refused on
 *   `md` in the type.
 *
 * `className` is for LAYOUT (`flex-1`) — never for re-padding. Two Tailwind
 * paddings on one element resolve by stylesheet source order, not string order, so a
 * caller-supplied `py-3` would win or lose depending on how the sheet was authored.
 * Pick a size instead. Same warning `ListState` carries about its `className`.
 *
 * ── WHY THE PADDING IS PHYSICAL ON BOTH AXES ──────────────────────────────────────
 * Tailwind 4 compiles `px-*` to LOGICAL `padding-inline` and `py-*` to `padding-block`, and a
 * text input does not honour both everywhere:
 *
 * - `px-*`: an Android `TextInput` drops it. On a moto g17 (#749, 2026-09-18, a 3.5px step)
 *   the same `sm` field put its text ~7dp from the border with `px-4` and ~17dp with
 *   `pl-4 pr-4`. iOS and the web build honour both spellings.
 * - `py-*`: a MULTI-LINE iOS `TextInput` lays out as if it were there and draws its text as
 *   if it were not. On an iPhone SE simulator (iOS 26.3, Expo Go, 2026-10-04) the first line
 *   of a field with `py-[13px]` stood 8pt higher than with `pt-[13px] pb-[13px]`, which put
 *   it within 1pt of a `Text` in a box of the same padding. A one-line field centres its text
 *   whatever the padding, so only a box shows it. Not measured on Android.
 *
 * The physical pairs (`pl-`/`pr-`, `pt-`/`pb-`) render as written on both devices, so this
 * file and `Field` spell nothing else. `source-audit.test.ts` §40 holds the inline half for
 * every `TextInput`, and its section 50 the block half for these two files.
 *
 * ── WHY 17PX AND NOT `type-body` ──────────────────────────────────────────────────
 * The text is body size, but a one-line field does not take the `type-body` class, because
 * that class carries body's 24pt line and iOS sets a one-line field's text low inside it. On
 * the same simulator and day, in a field with 13pt of padding: with `type-body` (52pt tall) a
 * value stood 19.5pt from the top and 14 from the bottom; with `text-[17px]` alone (50.5pt
 * tall), 16.5 and 15.5. As shipped the value stands 16.5 / 15 in the 50pt pill there, and
 * 16 / 15.2 on the moto g17.
 *
 * Tokens only — no literal hex. The one raw color is `placeholderTextColor`, which RN
 * requires as a value rather than a class; it comes from `@athanor/config`, the same
 * exception `SearchBar` documents.
 *
 * ── `trailing`: A CONTROL AT THE FIELD'S EDGE ─────────────────────────────────────
 * `trailing` is a SHAPE, not a `ReactNode`. The component owns the box — 44 wide, full
 * pill height, no hitSlop — and the caller owns only the glyph, the handler and the
 * label. Two reasons it is not a free node:
 *
 * - The right padding below is a promise about that width. A caller could hand in
 *   anything, and the promise would be one the component cannot keep.
 * - `source-audit.test.ts` §21's walk blanks brace contents, so a `Pressable` passed in
 *   from a call site is INVISIBLE to the nested-Pressable guard. Owning it here keeps
 *   it in a file the walk actually reads.
 *
 * It is `md`-only, enforced in the type rather than in prose: a compose bar puts its controls
 * BESIDE the field instead (chat's `+` and `›`).
 *
 * A field with a `trailing` control must sit under a `keyboardShouldPersistTaps="handled"`
 * scroll parent. With the default `"never"` the ScrollView eats the first tap to dismiss
 * the keyboard and the control appears dead.
 *
 * Measured on 2026-10-04 on an iPhone SE simulator (iOS 26.3, Expo Go) and a moto g17
 * (Android 15, dev client): `md` 50 and `sm` 44 at the default text size on both; at the
 * largest size the simulator gave 70.5 and 62.5, and the phone at a font scale of 2.0 gave
 * 64.4 and 56.4.
 */
type Size = 'md' | 'sm';

const SIZE_CLASSES: Record<Size, string> = {
  md: 'min-h-[50px] rounded-full pb-3 pl-5 pr-5 pt-3',
  sm: 'min-h-[44px] rounded-[22px] pb-2 pl-4 pr-4 pt-2',
};

/**
 * The `md` recipe with the right side opened for the trailing control. It REPLACES the size's
 * classes rather than extending them, so exactly one class per side ever lands on the element —
 * which is the whole of the padding warning above.
 *
 * `pr-14` is 56px. The control is 44 wide and flush right, so the text run clears it by
 * 12px. It was chosen while a `--spacing` step was 3.5px on device (until 2026-10-04,
 * #921): `pr-14` was 49 there and cleared by 5, and `pr-12` was 42 and did NOT clear —
 * while looking perfectly correct in the react-native-web harness, where it was 48.
 * Since then a step is 4px in both builds, and a number here is the same in each.
 */
const TRAILING_CLASSES = 'min-h-[50px] rounded-full pb-3 pl-5 pr-14 pt-3';

/** The caller's half of a trailing control: what to draw, what it does, what it is called. */
export type InputTrailing = {
  icon: ReactNode;
  onPress: () => void;
  /** Required: a glyph carries its state by shape, so the label has to carry it in words (G2). */
  accessibilityLabel: string;
};

export type InputProps = Omit<TextInputProps, 'multiline'> & {
  /** Lights the `error` border. The reason is the row's to render, under the field. */
  invalid?: boolean;
} & (
    | { size?: 'md'; trailing?: InputTrailing; multiline?: never }
    | { size: 'sm'; trailing?: never; multiline?: boolean }
  );

export function Input({
  size = 'md',
  trailing,
  invalid = false,
  className,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  // The wrapper below is CONDITIONAL, which `Field.tsx` rules out for its own error
  // wrapper — and for a reason that binds here too. Flipping `trailing`'s truthiness
  // changes the returned element TYPE, so React unmounts the TextInput and mounts a
  // fresh one: the keyboard drops mid-sentence, and worse, `Input` keeps its own
  // position, so `focused` stays true on a field that will never fire `onBlur` and the
  // focus border stays lit on nothing. It is safe only because `trailing` is a static per-call-
  // site decision. Nothing in the type system says that, so this does — and the wrong
  // shape to copy is already in the tree at `SearchBar`, whose clear-✕ is conditional
  // on the value being non-empty.
  // In an effect, not during render: a ref written while rendering is also written by a
  // render React then discards, which would burn the flag and swallow the next real one.
  const hasTrailing = trailing != null;
  const hadTrailing = useRef(hasTrailing);
  useEffect(() => {
    if (hadTrailing.current === hasTrailing) return;
    hadTrailing.current = hasTrailing;
    if (__DEV__) {
      console.warn(
        '[Input] `trailing` appeared or disappeared, which remounts the TextInput. Render it ' +
          'unconditionally and change its `icon`/`onPress` instead.',
      );
    }
  }, [hasTrailing]);

  // Forwarded, not replaced: StoriesViewer pauses the story on focus and resumes on
  // blur, so swallowing these would freeze the viewer on the reply field.
  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  const field = (
    <TextInput
      className={cn(
        'border bg-surface text-[17px] text-foreground',
        trailing ? TRAILING_CLASSES : SIZE_CLASSES[size],
        invalid ? 'border-error' : focused ? 'border-foreground' : 'border-transparent',
        className,
      )}
      placeholderTextColor={galleria.foregroundMuted}
      {...rest}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );

  if (!trailing) return field;

  return (
    // Bare on purpose — no border, no padding. Yoga insets an absolute child by the
    // parent's BORDER but not by its padding, so with the pill's border on the TextInput
    // `right-0` lands exactly on the field's outer edge. Move the border out here and the
    // control silently shifts inward by 1px.
    <View className="relative">
      {field}
      <Pressable
        // `inset-y-0`, not a fixed height: the pill's height is a floor (`min-h-[50px]`) that
        // grows with the member's text size, so a centred 44 would be a guess. This makes the
        // target the full pill height × 44. `style` for the width rather than `w-11`:
        // `source-audit.test.ts` §29 keeps the 44pt floor to one spelling, the literal. No
        // hitSlop: the rect is already 44 wide and as tall as the pill.
        className="absolute inset-y-0 right-0 items-center justify-center"
        style={{ width: 44 }}
        onPress={trailing.onPress}
        accessibilityRole="button"
        accessibilityLabel={trailing.accessibilityLabel}
      >
        {trailing.icon}
      </Pressable>
    </View>
  );
}
