import { View } from '@/tw';

/**
 * Placeholder bar for a loading state. `hair`, not `surface`: it stands on the black stage and
 * inside a charcoal block alike, and the block's own fill would hide it there.
 */
export function ShimmerBar({ width = 'w-full' }: { width?: string }) {
  return <View className={`h-5 rounded-[6px] bg-hair ${width}`} />;
}
