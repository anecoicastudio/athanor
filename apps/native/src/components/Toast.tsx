import { Text, View } from '@/tw';

export type ToastTone = 'success' | 'moment';

/**
 * Bottom toast pill — rendered ONLY by the ToastHost viewport (#117); screens
 * call `useToast().showToast(...)` instead of mounting this.
 * One recipe (charcoal block, hairline, centered) — 4 ad-hoc variants existed
 * before this component; don't hand-roll new ones.
 *
 * `bottom-10` positions against the Screen content region, so the pill clears
 * a pinned `Screen footer` by construction. `pointerEvents="none"`: a toast
 * never blocks a tap (DESIGN §10 tap targets stay whole while it holds).
 *
 * DESIGN §9: leading ✓ for a confirmation, ✦ for a moment event, both in foreground (no
 * green and no cyan on mobile). The mark lives HERE, not in the copy — toast strings carry no
 * trailing glyph (#119); pass `tone` instead. No `tone` = no mark (errors and neutral notices).
 */
export function Toast({ label, tone }: { label: string; tone?: ToastTone }) {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      className="absolute inset-x-5 bottom-10 flex-row items-center justify-center gap-2 rounded-[28px] border border-hair bg-surface px-5 py-3"
    >
      {tone ? (
        <Text
          className="type-small text-foreground"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {tone === 'moment' ? '✦' : '✓'}
        </Text>
      ) : null}
      <Text className="shrink text-center type-small text-foreground">{label}</Text>
    </View>
  );
}
