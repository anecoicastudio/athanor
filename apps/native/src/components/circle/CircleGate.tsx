import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { LockGlyph } from '@/components/glyphs';
import { useCircleSurface } from '@/hooks/use-circle-surface';
import { useEntitlement } from '@/hooks/use-entitlement';

/**
 * The one reusable Circle gate (M8 §3.4).
 *
 * Maps `feature` → `entitlement.features.*`, then lets `useCircleSurface` (#761) decide what a
 * non-member sees — the one decision every Circle-gated surface reads:
 *   • Loading (entitlement)  → renders nothing (avoids false "locked" flash).
 *   • unlocked               → renders `children` as-is. Every platform.
 *   • reserved / pending     → a neutral, NON-tappable lock: no «Sblocca», no route. iOS
 *                              non-members always (ruling 2026-09-22); Android/web while the
 *                              checkout flag's first read is in flight.
 *   • closed                 → the lock plus «La membership non è ancora aperta.», still routed
 *                              to the Circle screen, which says the same (ruling 2026-09-19).
 *   • open                   → the unlock affordance, routed to `upsellRoute`.
 *
 * Feature → entitlement flag mapping:
 *   advancedFilters  → features.advancedFilters
 *   premiumEvents    → features.premiumEvents
 *   analytics        → features.analytics
 *   marketCommissions→ features.marketReducedFee   (note: different name in EntitlementView)
 *
 * Variants:
 *   pill   — lock glyph + copy, used for the search advanced-filters pill (M8).
 *   label  — compact Tag-style lock label (M4 event cards).
 *   banner — bg-raise strip with unlock prompt (Fase-2 in-context teasers).
 *
 * Rule #4 compliance: NO cyan fill, NO glow on lock affordances. Lock pill uses
 * `bg-raise` + `border-hair` + muted text — a quiet/neutral affordance.
 * `aura` cyan is never used on the gate chrome.
 *
 * Accessibility: every variant carries `accessibilityLabel={t('circle.gate.a11y', locale)}`
 * plus the state ("bloccato" / "sbloccato"). Only a tappable lock is a button, and its hint
 * says where the tap leads — «Sblocca» while checkout is open, the closed line while it is not.
 */

type GateFeature = 'advancedFilters' | 'premiumEvents' | 'analytics' | 'marketCommissions';
type GateVariant = 'pill' | 'label' | 'banner';

export function CircleGate({
  feature,
  variant,
  children,
  upsellRoute = '/(modal)/circle',
  locale,
}: {
  feature: GateFeature;
  variant: GateVariant;
  children: ReactNode;
  upsellRoute?: string;
  locale: Locale;
}) {
  const router = useRouter();
  const { data: entitlement, isLoading } = useEntitlement();

  // Map feature prop → the correct flag in EntitlementView.features
  const featureEnabled =
    entitlement == null
      ? false
      : feature === 'marketCommissions'
        ? entitlement.features.marketReducedFee
        : entitlement.features[feature];
  const surface = useCircleSurface(featureEnabled);

  // While loading, render nothing to avoid a false "locked" flash
  if (isLoading || !entitlement) return null;

  // Unlocked → render children directly
  if (surface === 'unlocked') {
    return (
      <View
        accessibilityLabel={t('circle.gate.a11y', locale)}
        accessibilityHint={t('common.unlocked', locale)}
        accessibilityRole="none"
      >
        {children}
      </View>
    );
  }

  const a11yLabel = `${t('circle.gate.a11y', locale)} — ${t('common.locked', locale)}`;
  const closedLine = t('circle.checkoutClosed', locale);

  // The lock's own words. The banner's used to be «Sblocca nel Circle», which is a promise —
  // it keeps that only while checkout is open; otherwise it takes the neutral label.
  const unlock = surface === 'open' ? t('circle.gate.unlock', locale) : null;
  const lockCopy =
    variant === 'pill'
      ? t('search.filters.locked', locale)
      : variant === 'label'
        ? t('circle.gate.premiumEvents', locale)
        : (unlock ?? t('circle.gate.reserved', locale));

  const face =
    variant === 'pill' ? (
      <>
        {/* Lock mark — drawn, not the 🔒 emoji (#753); the label says «bloccato» */}
        <LockGlyph size={16} color={semantic.foregroundMuted} />
        <Text className="text-[14px] text-muted-foreground">{lockCopy}</Text>
      </>
    ) : variant === 'label' ? (
      <Text className="text-[12px] text-muted-foreground">{lockCopy}</Text>
    ) : (
      <>
        <Text className="text-[14px] text-muted-foreground">{lockCopy}</Text>
        <Text className="mt-1 text-[12px] text-faint">{t('circle.assurance.quote', locale)}</Text>
      </>
    );

  const shape =
    variant === 'pill'
      ? 'flex-row items-center gap-2 self-start rounded-full border border-hair bg-raise px-4 py-2.5'
      : variant === 'label'
        ? 'self-start rounded-full border border-hair bg-raise-2 px-3 py-1'
        : 'rounded-card border border-hair bg-raise px-4 py-4';
  const minHeight = variant === 'pill' ? 44 : variant === 'label' ? 28 : 56;

  // reserved (iOS non-member) / pending (flag unread) → a label, not a button: nothing to tap,
  // nowhere to go. The same face, so the lock reads the same on every platform.
  if (surface === 'reserved' || surface === 'pending') {
    return (
      // `accessible` makes the View one element: without it iOS skips the label and VoiceOver
      // reads only the child text, losing «bloccato».
      <View className={shape} accessible accessibilityLabel={a11yLabel} style={{ minHeight }}>
        {face}
      </View>
    );
  }

  const handleUpsell = () => {
    router.push(upsellRoute as Parameters<typeof router.push>[0]);
  };

  const button = (
    <Pressable
      className={shape}
      onPress={handleUpsell}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={unlock ?? closedLine}
      // The label's 28pt box is deliberate — a Tag-sized lock inside an event card's tag row,
      // and growing it to 44 would break that row. §10's floor is not optional though, so it
      // comes from slop instead: 28 + 2×8 = 44.
      hitSlop={variant === 'label' ? 8 : undefined}
      style={{ minHeight }}
    >
      {face}
    </Pressable>
  );

  if (surface === 'open') return button;

  // closed → still locked, still routed to the Circle screen (which says the same), plus the
  // line that stops the lock from promising a join that cannot happen yet.
  return (
    <View className="gap-1.5">
      {button}
      {/* The button's hint already says it; hidden from screen readers so it is not read twice. */}
      <Text
        className="text-[12px] text-faint"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {closedLine}
      </Text>
    </View>
  );
}
