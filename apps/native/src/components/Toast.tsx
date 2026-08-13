import { Text, View, cn } from '@/tw';

export type ToastTone = 'success' | 'moment';

/**
 * Inline bottom toast — the app has no global toast host ((modal) routes
 * instead), so screens render this conditionally with their own timer.
 * One recipe (raised card, hairline, centered) — 4 ad-hoc variants existed
 * before this component; don't hand-roll new ones.
 *
 * DESIGN §9: leading ✓ in success / ✦ in `aura` for moment events. The mark lives HERE,
 * not in the copy — toast strings carry no trailing glyph (#119); pass `tone` instead.
 * No `tone` = no mark (errors and neutral notices).
 */
export function Toast({ label, tone }: { label: string; tone?: ToastTone }) {
  return (
    <View className="absolute inset-x-5 bottom-10 flex-row items-center justify-center gap-2 rounded-card border border-hair bg-raise-2 px-5 py-3">
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
