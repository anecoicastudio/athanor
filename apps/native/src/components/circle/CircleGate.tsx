import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { useEntitlement } from '@/hooks/use-entitlement';

/**
 * The one reusable Circle gate (M8 §3.4).
 *
 * Maps `feature` → `entitlement.features.*` and renders one of three states:
 *   • Unlocked (member + feature enabled) → renders `children` as-is.
 *   • Locked                               → renders the lock affordance for `variant`.
 *   • Loading                              → renders nothing (avoids false "locked" flash).
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
 * plus a state hint ("bloccato" / "sbloccato").
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

  // While loading, render nothing to avoid a false "locked" flash
  if (isLoading || !entitlement) return null;

  // Map feature prop → the correct flag in EntitlementView.features
  const featureEnabled =
    feature === 'marketCommissions'
      ? entitlement.features.marketReducedFee
      : entitlement.features[feature];

  // Unlocked → render children directly
  if (featureEnabled) {
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

  // Locked → render the appropriate variant
  const handleUpsell = () => {
    router.push(upsellRoute as Parameters<typeof router.push>[0]);
  };

  const a11yLabel = `${t('circle.gate.a11y', locale)} — ${t('common.locked', locale)}`;

  if (variant === 'pill') {
    return (
      <Pressable
        className="flex-row items-center gap-2 rounded-full border border-hair bg-raise px-4 py-2.5"
        onPress={handleUpsell}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={t('circle.gate.unlock', locale)}
        style={{ minHeight: 44 }}
      >
        {/* Lock glyph — text equivalent via accessibilityLabel */}
        <Text className="text-[14px] text-muted-foreground" accessibilityLabel="">
          🔒
        </Text>
        <Text className="text-[14px] text-muted-foreground">
          {t('search.filters.locked', locale)}
        </Text>
      </Pressable>
    );
  }

  if (variant === 'label') {
    // Compact Tag-style lock label (M4 event cards)
    return (
      <Pressable
        className="rounded-full border border-hair bg-raise-2 px-3 py-1"
        onPress={handleUpsell}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={t('circle.gate.unlock', locale)}
        // The 28pt box is deliberate — this is a Tag-sized lock inside an event card's tag
        // row, and growing it to 44 would break that row. §10's floor is not optional
        // though, so it comes from slop instead: 28 + 2×8 = 44.
        hitSlop={8}
        style={{ minHeight: 28 }}
      >
        <Text className="text-[12px] text-muted-foreground">
          {t('circle.gate.premiumEvents', locale)}
        </Text>
      </Pressable>
    );
  }

  // variant === 'banner'
  // A bg-raise strip — for in-context non-member teasers (Fase 2)
  return (
    <Pressable
      className="rounded-card border border-hair bg-raise px-4 py-4"
      onPress={handleUpsell}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={t('circle.gate.unlock', locale)}
      style={{ minHeight: 56 }}
    >
      <Text className="text-[14px] text-muted-foreground">{t('circle.gate.unlock', locale)}</Text>
      <Text className="mt-1 text-[12px] text-faint">{t('circle.assurance.quote', locale)}</Text>
    </Pressable>
  );
}
