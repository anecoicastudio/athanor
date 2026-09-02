import type { ReactNode } from 'react';
import { Pressable, Text, View } from '@/tw';
import { useGuardedBack, type ExitHref } from '@/lib/modal-exit';

/**
 * Canonical screen header (DESIGN §6 → Screen headers): left-aligned, h1 = 24/600.
 * One recipe for every pushed screen and sheet — don't hand-roll headers (chevron
 * size/color, title weight, paddings and hit-slops drifted across 7 clusters
 * before the recipe covered their cases — #162).
 *
 * Shapes it covers:
 * - pushed screen: back chevron ‹ + title (+ `right` actions)
 * - sheet: `leading="none"` + title (+ `subtitle`) + `right={<HeaderClose …/>}`
 * - identity header (chat): `avatar` + compact 15/600 title + `subtitle`; `onIdentityPress`
 *   makes avatar+title+subtitle ONE pressable block (the identity IS the link, #356 — no
 *   second ↗-style affordance beside it, or VoiceOver announces two identical targets)
 * - search: `titleSlot` replaces the title text entirely
 * - immersive media (lightbox): `leading="close"` — ✕ sits left, label left-aligned
 *
 * The default chevron ALWAYS renders and never dead-ends (#578): it pops the stack when
 * there is one and lands on `fallbackHref` (home by default) when this screen IS the stack,
 * via `useGuardedBack`. It used to hide itself on a stack root instead — which sounds safe
 * and is not: a deep link, a `replace` from `[handle].tsx`, or the auth gate leaves the
 * screen with no back affordance AND no other way out (DESIGN §11, 2026-08-27).
 *
 * An explicit `onBack` still wins, for a caller that knows where back goes — but it takes on
 * the same duty: `useGuardedBack('/(tabs)/…')` for a plain exit to a specific parent, and
 * never a bare `router.back()`. `source-audit.test.ts` §23 enforces that.
 *
 * `backLabel` / `title` arrive already translated (zero i18n keys here).
 * `backLabel` is required on every `leading` other than `'none'` — since #578 the affordance
 * renders unconditionally there, so a missing label is a silent unlabelled button rather than
 * a rare one. §23 asserts it.
 */
export function ModalHeader({
  title,
  titleSlot,
  subtitle,
  avatar,
  leading = 'chevron',
  backLabel,
  onBack,
  fallbackHref,
  onIdentityPress,
  identityLabel,
  identityHint,
  right,
}: {
  /** h1 24/600 — or compact 15/600 when `avatar` is present. */
  title?: string;
  /** Replaces the title text entirely (e.g. the search bar). */
  titleSlot?: ReactNode;
  /** String gets the recipe's style (14 faint; 11 faint next to an avatar); a node renders as-is. */
  subtitle?: ReactNode;
  avatar?: ReactNode;
  /** Left affordance: back chevron (default), close ✕ (immersive media), or nothing (sheets, tab roots). */
  leading?: 'chevron' | 'close' | 'none';
  backLabel?: string;
  onBack?: () => void;
  /**
   * Where the default affordance lands when this screen is the stack root — home unless the
   * screen has a more specific parent. Ignored when `onBack` is given (that handler owns the
   * destination, and owes the same guard).
   */
  fallbackHref?: ExitHref;
  /** Makes avatar+title+subtitle one pressable identity block (#356). */
  onIdentityPress?: () => void;
  /** a11y label for the identity block — arrives already translated, like `backLabel`. The
   * pressable masks its children for screen readers, so the label must carry the content
   * (name + subtitle info), not just the action — the action goes in `identityHint`. */
  identityLabel?: string;
  identityHint?: string;
  right?: ReactNode;
}) {
  const guardedBack = useGuardedBack(fallbackHref);
  const showLeading = leading !== 'none';
  const compact = avatar != null;
  const titleClass = compact
    ? 'text-[15px] font-semibold text-foreground'
    : 'text-2xl font-semibold text-foreground';
  const identity = (
    <>
      {avatar}
      {titleSlot != null ? (
        <View className="flex-1">{titleSlot}</View>
      ) : subtitle != null || compact ? (
        <View className="flex-1">
          <Text accessibilityRole="header" numberOfLines={1} className={titleClass}>
            {title}
          </Text>
          {subtitle == null ? null : typeof subtitle === 'string' ? (
            <Text
              numberOfLines={1}
              className={compact ? 'text-[11px] text-faint' : 'text-[14px] text-faint'}
            >
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
        </View>
      ) : (
        <Text accessibilityRole="header" numberOfLines={1} className={`flex-1 ${titleClass}`}>
          {title}
        </Text>
      )}
    </>
  );
  return (
    // Top inset is the parent Screen's job (#161) — pt here is breathing room off the
    // sheet edge (or the inset), pb is the one header→content gap every screen shares.
    <View className="flex-row items-center gap-3 px-gutter pb-4 pt-3">
      {showLeading ? (
        <Pressable
          onPress={onBack ?? guardedBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          // A real box, not a bare glyph + hitSlop: the glyph measured ~6pt wide, so
          // HIT_SLOP's 11 each side reached 28 — under §10's 44 floor on the axis that
          // matters. Literal `[44px]`, not `h-11`, because a spacing step is 3.5px on
          // device (`h-11` = 38.5pt there while measuring a passing 44px on web). `-ml-3`
          // keeps the glyph optically on the gutter — the same recipe as the reserved back
          // slot in (onboarding)/index.tsx, welcome.tsx and forgot-password.tsx. No
          // hitSlop now: the rect already clears 44, and slop would reach into the
          // identity target 12pt to its right.
          className="-ml-3 h-[44px] w-[44px] items-center justify-center"
        >
          <Text className="text-2xl text-foreground">{leading === 'close' ? '✕' : '‹'}</Text>
        </Pressable>
      ) : null}
      {onIdentityPress == null ? (
        identity
      ) : (
        <Pressable
          onPress={onIdentityPress}
          accessibilityRole="button"
          accessibilityLabel={identityLabel}
          accessibilityHint={identityHint}
          // 36pt avatar + 4pt each side = the 44pt target, without growing the header.
          hitSlop={{ top: 4, bottom: 4 }}
          className="flex-1 flex-row items-center gap-3"
        >
          {identity}
        </Pressable>
      )}
      {right}
    </View>
  );
}

/**
 * Right-slot ✕ for self-dismissing sheets (recap, favor — DESIGN §6): pass as
 * `right={<HeaderClose …/>}` with `leading="none"`. Immersive media keeps its
 * ✕ on the LEFT via `leading="close"` instead.
 */
export function HeaderClose({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Same box-not-slop fix as the leading chevron above; `-mr-3` mirrors its `-ml-3`
      // so the ✕ stays optically on the right gutter.
      className="-mr-3 h-[44px] w-[44px] items-center justify-center"
    >
      <Text className="text-2xl text-foreground">✕</Text>
    </Pressable>
  );
}
