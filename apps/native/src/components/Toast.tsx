import { Text, View } from '@/tw';

/**
 * Inline bottom toast — the app has no global toast host ((modal) routes
 * instead), so screens render this conditionally with their own timer.
 * One recipe (raised card, hairline, centered) — 4 ad-hoc variants existed
 * before this component; don't hand-roll new ones.
 */
export function Toast({ label }: { label: string }) {
  return (
    <View className="absolute inset-x-5 bottom-10 items-center rounded-card border border-hair bg-raise-2 px-5 py-3">
      <Text className="text-center text-[13px] text-foreground">{label}</Text>
    </View>
  );
}
