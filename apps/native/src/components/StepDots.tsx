import { View } from '@/tw';

/**
 * Progress dots. Dot i ≤ current is filled (foreground). Currently unused —
 * deferred: the candidacy flow (M7) uses this dot variant; the onboarding funnel
 * uses `StepBars`. Kept intentionally; do not delete before M7.
 */
export function StepDots({ count, current }: { count: number; current: number }) {
  return (
    <View
      className="flex-row gap-2"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: count, now: current + 1 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          className={
            i <= current ? 'h-2 w-2 rounded-full bg-foreground' : 'h-2 w-2 rounded-full bg-hair'
          }
        />
      ))}
    </View>
  );
}
