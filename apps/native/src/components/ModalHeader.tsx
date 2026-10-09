import type { ReactNode } from 'react';
import { galleria } from '@athanor/config';
import { Pressable, Text, View, cn } from '@/tw';
import { BackIcon, CloseIcon } from '@/components/glyphs';
import { useGuardedBack, type ExitHref } from '@/lib/modal-exit';
import { PRESS_DIM } from '@/lib/press';
import { wordLines } from '@/lib/word-lines';

/**
 * Canonical screen header (DESIGN §6 → Screen headers): left-aligned, the title in `type-title`
 * (24/600), 8 between the band's parts, as the prototype's `.top`.
 * One recipe for every pushed screen and sheet — don't hand-roll headers (chevron
 * size/color, title weight, paddings and hit-slops drifted across 7 clusters
 * before the recipe covered their cases — #162).
 *
 * The back and the close are drawings (`BackIcon`, `CloseIcon`, DESIGN §6 «Interface icons»)
 * inside `HeaderBack` / `HeaderClose` below; until Galleria (2026-10-04, #921) they were the
 * characters `‹` and `✕`. The `leading` value is still spelled `'chevron'`.
 *
 * Shapes it covers:
 * - pushed screen: the drawn back + title (+ `right` actions)
 * - sheet: `leading="none"` + title (+ `subtitle`) + `right={<HeaderClose …/>}`
 * - identity header (chat): `avatar` + the name in body medium (17/500) + `subtitle`, the
 *   avatar 10 from the text (the prototype's `.line`); `onIdentityPress`
 *   makes avatar+title+subtitle ONE pressable block (the identity IS the link, #356 — no
 *   second ↗-style affordance beside it, or VoiceOver announces two identical targets)
 * - search: `titleSlot` replaces the title text entirely
 * - immersive media (lightbox): `leading="close"` — the close sits left, label left-aligned
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
  /** `type-title` (24/600) — or body medium (17/500) when `avatar` is present. */
  title?: string;
  /** Replaces the title text entirely (e.g. the search bar). */
  titleSlot?: ReactNode;
  /** A string is the small grey line (`type-small`), two lines at most; a node renders as-is. */
  subtitle?: ReactNode;
  avatar?: ReactNode;
  /** Left affordance: the drawn back (default), the drawn close (immersive media), or nothing (sheets, tab roots). */
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
    ? 'type-body font-medium text-foreground'
    : 'type-title text-foreground';
  const identity = (
    <>
      {avatar}
      {titleSlot != null ? (
        <View className="flex-1">{titleSlot}</View>
      ) : subtitle != null || compact ? (
        <View className="flex-1">
          {/* Two lines (#639): a header IS the screen's name — truncating it at AX sizes
              leaves «Impostazion…» where the whole point of the band is orientation. The
              band has no fixed height, so the second line costs nothing at default size.
              A ONE-word title takes one line (#754): its second line could only be filled by
              breaking the word — «Notifi / che» beside the header actions at AX5 on the SE —
              so it ellipsizes instead, and the label keeps the whole title. */}
          <Text
            accessibilityRole="header"
            accessibilityLabel={title}
            numberOfLines={wordLines(title)}
            className={titleClass}
          >
            {title}
          </Text>
          {subtitle == null ? null : typeof subtitle === 'string' ? (
            <Text numberOfLines={2} className="type-small text-muted-foreground">
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
        </View>
      ) : (
        <Text
          accessibilityRole="header"
          accessibilityLabel={title}
          numberOfLines={wordLines(title)}
          className={`flex-1 ${titleClass}`}
        >
          {title}
        </Text>
      )}
    </>
  );
  return (
    // Top inset is the parent Screen's job (#161) — pt here is breathing room off the
    // sheet edge (or the inset), pb is the one header→content gap every screen shares.
    <View className="flex-row items-center gap-2 px-gutter pb-4 pt-3">
      {showLeading ? (
        // `backLabel` is required on every `leading` but 'none' (the docblock above; §23 of
        // `source-audit.test.ts` holds it at the call sites), so the fallback never renders.
        leading === 'close' ? (
          <HeaderClose side="left" label={backLabel ?? ''} onPress={onBack ?? guardedBack} />
        ) : (
          <HeaderBack
            label={backLabel ?? ''}
            onPress={onBack ?? guardedBack}
            className={BACK_ON_GUTTER}
          />
        )
      ) : null}
      {onIdentityPress == null ? (
        identity
      ) : (
        <Pressable
          onPress={onIdentityPress}
          accessibilityRole="button"
          accessibilityLabel={identityLabel}
          accessibilityHint={identityHint}
          // 4pt of slop above and below the block, without growing the header.
          hitSlop={{ top: 4, bottom: 4 }}
          className={cn('flex-1 flex-row items-center gap-[10px]', PRESS_DIM)}
        >
          {identity}
        </Pressable>
      )}
      {right}
    </View>
  );
}

/**
 * The box of a header control (DESIGN §10): 44pt each way by `min-h` / `min-w`, the drawing
 * centred in it. A real box, not a bare glyph + hitSlop: slop would reach into the identity
 * target 8pt to the right of the leading control. Literal `[44px]`, the one spelling of the
 * floor (`source-audit.test.ts` section 29).
 */
const ICON_BUTTON = 'min-h-[44px] min-w-[44px] items-center justify-center';

/** The drawing's size inside the box: 22, as the prototype draws it (`icons()` in `build.py`).
 *  It is a drawing, so the member's text size does not move it; the 44pt box is the target. */
const ICON_SIZE = 22;

/**
 * Pulls the back's box left so the drawing stands near the gutter: the prototype's
 * `.ib.bk { margin-left: -14px }`. It was `-ml-3` while the control was the character `‹`.
 * A screen that reserves the slot itself (welcome, forgot-password, onboarding) puts this on
 * the slot, not on the control.
 */
export const BACK_ON_GUTTER = '-ml-[14px]';

function HeaderIcon({
  label,
  onPress,
  className,
  children,
}: {
  label: string;
  onPress: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(ICON_BUTTON, PRESS_DIM, className)}
    >
      {/* The button names itself; the drawing says nothing to assistive tech. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}

/**
 * The back control: the drawn back in a 44pt button. `ModalHeader` renders it for
 * `leading="chevron"`; a screen that builds its own header band (welcome, forgot-password,
 * onboarding, the candidacy wizard) renders it directly, so there is one back in the app.
 * It carries no margin of its own: the caller places it (`BACK_ON_GUTTER`).
 */
export function HeaderBack({
  label,
  onPress,
  className,
}: {
  label: string;
  onPress: () => void;
  className?: string;
}) {
  return (
    <HeaderIcon label={label} onPress={onPress} className={className}>
      <BackIcon size={ICON_SIZE} color={galleria.foreground} />
    </HeaderIcon>
  );
}

/**
 * The close control. Right slot of a self-dismissing sheet (recap, favor — DESIGN §6): pass as
 * `right={<HeaderClose …/>}` with `leading="none"`. Immersive media keeps its close on the
 * LEFT via `leading="close"`, which renders this with `side="left"`. The 12 of negative margin
 * on its side is the prototype's `.ib.rt`, and the value the character had.
 */
export function HeaderClose({
  label,
  onPress,
  side = 'right',
}: {
  label: string;
  onPress: () => void;
  side?: 'left' | 'right';
}) {
  return (
    <HeaderIcon label={label} onPress={onPress} className={side === 'left' ? '-ml-3' : '-mr-3'}>
      <CloseIcon size={ICON_SIZE} color={galleria.foreground} />
    </HeaderIcon>
  );
}
