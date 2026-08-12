import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';

/**
 * Canonical screen header (DESIGN §6 → Screen headers): left-aligned, h1 = 24/600.
 * One recipe for every pushed screen and sheet — don't hand-roll headers (chevron
 * size/color, title weight, paddings and hit-slops drifted across 7 clusters
 * before the recipe covered their cases — #162).
 *
 * Shapes it covers:
 * - pushed screen: back chevron ‹ + title (+ `right` actions)
 * - sheet: `leading="none"` + title (+ `subtitle`) + `right={<HeaderClose …/>}`
 * - identity header (chat): `avatar` + compact 15/600 title + `subtitle`
 * - search: `titleSlot` replaces the title text entirely
 * - immersive media (lightbox): `leading="close"` — ✕ sits left, label left-aligned
 *
 * The default chevron hides itself on a stack root (`router.canGoBack()` false —
 * e.g. a deep link landed here), so no screen renders a dead back affordance. An
 * explicit `onBack` always renders: the caller knows where back goes (dismissTo).
 *
 * `backLabel` / `title` arrive already translated (zero i18n keys here).
 * `backLabel` is required whenever a leading affordance can render.
 */
export function ModalHeader({
  title,
  titleSlot,
  subtitle,
  avatar,
  leading = 'chevron',
  backLabel,
  onBack,
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
  right?: ReactNode;
}) {
  const router = useRouter();
  const showLeading =
    leading !== 'none' && (leading === 'close' || onBack != null || router.canGoBack());
  const compact = avatar != null;
  const titleClass = compact
    ? 'text-[15px] font-semibold text-foreground'
    : 'text-2xl font-semibold text-foreground';
  return (
    // Top inset is the parent Screen's job (#161) — pt here is breathing room off the
    // sheet edge (or the inset), pb is the one header→content gap every screen shares.
    <View className="flex-row items-center gap-3 px-gutter pb-4 pt-3">
      {showLeading ? (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
        >
          <Text className="text-2xl text-foreground">{leading === 'close' ? '✕' : '‹'}</Text>
        </Pressable>
      ) : null}
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
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text className="text-2xl text-foreground">✕</Text>
    </Pressable>
  );
}
