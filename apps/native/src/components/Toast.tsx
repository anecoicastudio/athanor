import { Text, View, cn } from '@/tw';

export type ToastTone = 'success' | 'moment';

/**
 * Bottom toast pill — rendered ONLY by the ToastHost viewport (#117); screens
 * call `useToast().showToast(...)` instead of mounting this. (The one hold-out
 * is ConnectButton's hand-rolled pill, which #118 deletes.)
 * One recipe (raised card, hairline, centered) — 4 ad-hoc variants existed
 * before this component; don't hand-roll new ones.
 *
 * `bottom-10` positions against the Screen content region, so the pill clears
 * a pinned `Screen footer` by construction. `pointerEvents="none"`: a toast
 * never blocks a tap (DESIGN §10 tap targets stay whole while it holds).
 *
 * DESIGN §9: leading ✓ in success / ✦ in `aura` for moment events. The mark lives HERE,
 * not in the copy — toast strings carry no trailing glyph (#119); pass `tone` instead.
 * No `tone` = no mark (errors and neutral notices).
 */
export function Toast({ label, tone }: { label: string; tone?: ToastTone }) {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      className="absolute inset-x-5 bottom-10 flex-row items-center justify-center gap-2 rounded-card border border-hair bg-raise-2 px-5 py-3"
    >
      {tone ? (
        <Text
          className={cn('text-[13px]', tone === 'moment' ? 'text-aura' : 'text-faint')}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {tone === 'moment' ? '✦' : '✓'}
        </Text>
      ) : null}
      <Text className="text-center text-[13px] text-foreground">{label}</Text>
    </View>
  );
}
