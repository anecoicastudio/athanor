import { useEffect, useRef, useState, type ReactNode } from 'react';
import { semantic } from '@athanor/config';
import { Pressable, TextInput, View, cn, type TextInputProps } from '@/tw';

/**
 * The one pill text field (DESIGN §9 Input: radius full, `raise` surface, hairline
 * border, foreground text, placeholder `foregroundMuted`, focus = foreground ring 1px).
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
 * - `md` (default) — a form field on a form screen. `px-5 py-4` at 15pt lands the pill
 *   at ~52pt, which is the `Button` height (DESIGN §9), so a field and the CTA under it
 *   are the same pill. The six form spellings above all collapse here.
 * - `sm` — the compose bar: a `flex-1` field sharing a bottom row with a 44pt send
 *   button (chat, post comments, story replies). A 52pt pill there would out-rank the
 *   send button and eat the keyboard-adjacent viewport, so its shorter `py-2` really is
 *   intentional and survives as a size rather than as a call-site override.
 *
 * `className` is for LAYOUT (`flex-1`, `min-h-*`) — never for re-padding. Two Tailwind
 * paddings on one element resolve by stylesheet source order, not string order, so a
 * caller-supplied `py-3` would win or lose depending on how the sheet was authored.
 * Pick a size instead. Same warning `ListState` carries about its `className`.
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
 * It is `md`-only, enforced in the type rather than in prose: the `sm` pill is ~32pt, so
 * a 44pt target inside it is impossible, and the only fix — vertical hitSlop — pushes
 * the touch rect outside the wrapper, which Android does not deliver. A compose bar puts
 * its controls BESIDE the field instead (chat's `+` and `›`).
 *
 * A field with a `trailing` control must sit under a `keyboardShouldPersistTaps="handled"`
 * scroll parent. With the default `"never"` the ScrollView eats the first tap to dismiss
 * the keyboard and the control appears dead.
 */
type Size = 'md' | 'sm';

const SIZE_CLASSES: Record<Size, string> = {
  md: 'px-5 py-4 text-[15px]',
  sm: 'px-4 py-2 text-[15px]',
};

/**
 * The same recipe with the right side opened for the trailing control. It REPLACES
 * `SIZE_CLASSES` rather than extending it, so exactly one horizontal padding class ever
 * lands on the element — which is the whole of the warning above.
 *
 * `pr-14` is 49px ON DEVICE and 56 on web: `react-native-css` inlines `rem` at 14 here,
 * so a `--spacing` step is 3.5px, not 4. The control is 44 wide and flush right, so the
 * text run clears it by 5px. `pr-12` is 42 on device and does NOT clear — while looking
 * perfectly correct in the react-native-web harness, where it is 48. Every number in
 * this file's trailing path is a device number.
 */
const SIZE_CLASSES_TRAILING: Record<Size, string> = {
  md: 'pl-5 pr-14 py-4 text-[15px]',
  sm: 'pl-4 pr-14 py-2 text-[15px]',
};

/** The caller's half of a trailing control: what to draw, what it does, what it is called. */
export type InputTrailing = {
  icon: ReactNode;
  onPress: () => void;
  /** Required: a glyph carries its state by shape, so the label has to carry it in words (G2). */
  accessibilityLabel: string;
};

export type InputProps = TextInputProps &
  ({ size?: 'md'; trailing?: InputTrailing } | { size: 'sm'; trailing?: never });

export function Input({ size = 'md', trailing, className, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  // The wrapper below is CONDITIONAL, which `Field.tsx` rules out for its own error
  // wrapper — and for a reason that binds here too. Flipping `trailing`'s truthiness
  // changes the returned element TYPE, so React unmounts the TextInput and mounts a
  // fresh one: the keyboard drops mid-sentence, and worse, `Input` keeps its own
  // position, so `focused` stays true on a field that will never fire `onBlur` and the
  // ring stays lit on nothing. It is safe only because `trailing` is a static per-call-
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
        'rounded-full border bg-raise text-foreground',
        (trailing ? SIZE_CLASSES_TRAILING : SIZE_CLASSES)[size],
        focused ? 'border-foreground' : 'border-hair',
        className,
      )}
      placeholderTextColor={semantic.foregroundMuted}
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
        // `inset-y-0`, not a fixed height: the pill's height is emergent (`py-4` plus the
        // platform's intrinsic line box), so a centred 44 would be a guess. This makes the
        // target the full pill height × 44. `style` for the width rather than `w-11`,
        // because a spacing step is 3.5px on device and `w-11` would be 38.5pt — under
        // G2/A-1's 44pt floor while measuring a passing 44px on web. No hitSlop: the rect
        // already clears 44, and slop would extend past the wrapper into the region
        // Android declines to deliver.
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
