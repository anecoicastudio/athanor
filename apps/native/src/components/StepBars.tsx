import { View } from '@/tw';

/**
 * Onboarding progress bars (prototype `.ob-steps`): equal-width horizontal bars,
 * bar i ≤ current is lit cyan. The bar form is the prototype's onboarding look;
 * `StepDots` stays for the candidacy flow (M7) that uses a dot variant.
 */
export function StepBars({ count, current }: { count: number; current: number }) {
  return (
    // No `flex-1` (#754): in the onboarding column it meant a height basis of 0, and the row
    // collapsed by its own 3.5pt whenever a step overflowed (the date wheel open), moving the
    // eyebrow and the step under it. The column already stretches it to full width.
    <View
      className="flex-row gap-1.5"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: count, now: current + 1 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          className={
            i <= current
              ? 'h-[3px] flex-1 rounded-full bg-aura'
              : 'h-[3px] flex-1 rounded-full bg-raise-2'
          }
        />
      ))}
    </View>
  );
}
