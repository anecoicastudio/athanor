import { View } from '@/tw';

/** Cold-load placeholder — 3 ghost cards. Static (reduced-motion safe); resilience §6.1/§14. */
export function FeedSkeleton() {
  return (
    <View className="gap-4 px-5">
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-3 rounded-card border border-hair bg-raise p-5">
          <View className="h-3 w-24 rounded bg-raise-2" />
          <View className="h-4 w-full rounded bg-raise-2" />
          <View className="h-4 w-2/3 rounded bg-raise-2" />
        </View>
      ))}
    </View>
  );
}
