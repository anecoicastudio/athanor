import { View } from '@/tw';

/** Onboarding/candidacy progress dots. Dot i ≤ current is filled (cyan-accent). */
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
            i <= current ? 'h-2 w-2 rounded-full bg-aura' : 'h-2 w-2 rounded-full bg-raise-2'
          }
        />
      ))}
    </View>
  );
}
