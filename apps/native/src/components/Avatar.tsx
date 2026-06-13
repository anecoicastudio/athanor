import { Text, View } from '@/tw';

/**
 * Circle avatar with an initial fallback (DESIGN.md §8). No image upload in M1;
 * the oro evolutionary-story ring is deferred to M3.
 */
export function Avatar({ handle }: { handle: string | null }) {
  const initial = (handle ?? '?').charAt(0).toUpperCase();
  return (
    <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-muted">
      <Text className="text-[28px] font-semibold text-foreground">{initial}</Text>
    </View>
  );
}
