import { View } from '@/tw';

/**
 * Cold-load placeholder — three ghost posts, each the borderless `surface` block a post is
 * (`FeedPost`), 26 apart. Static (reduced-motion safe); resilience §6.1/§14.
 */
export function FeedSkeleton() {
  return (
    <View className="gap-[26px] px-5">
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-[10px] rounded-[28px] bg-surface px-4 py-[14px]">
          <View className="h-3 w-24 rounded-full bg-hair" />
          <View className="h-4 w-full rounded-full bg-hair" />
          <View className="h-4 w-2/3 rounded-full bg-hair" />
        </View>
      ))}
    </View>
  );
}
