import { useState } from 'react';
import { semantic } from '@athanor/config';
import { TextInput, cn, type TextInputProps } from '@/tw';

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
 */
type Size = 'md' | 'sm';

const SIZE_CLASSES: Record<Size, string> = {
  md: 'px-5 py-4 text-[15px]',
  sm: 'px-4 py-2 text-[15px]',
};

export type InputProps = TextInputProps & { size?: Size };

export function Input({ size = 'md', className, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

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

  return (
    <TextInput
      className={cn(
        'rounded-full border bg-raise text-foreground',
        SIZE_CLASSES[size],
        focused ? 'border-foreground' : 'border-hair',
        className,
      )}
      placeholderTextColor={semantic.foregroundMuted}
      {...rest}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
