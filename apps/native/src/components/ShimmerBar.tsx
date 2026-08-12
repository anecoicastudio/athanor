import { View } from '@/tw';

/** Shimmer placeholder bar — muted rect for loading state. */
export function ShimmerBar({ width = 'w-full' }: { width?: string }) {
  return <View className={`h-5 rounded-sm bg-raise ${width}`} />;
}
