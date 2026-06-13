import { Text, View } from '@/tw';

/**
 * Circle avatar with an initial fallback (DESIGN.md §8). No image upload in M1;
 * the oro evolutionary-story ring is deferred to M3.
 */
export function Avatar({ handle, size = 72 }: { handle: string | null; size?: number }) {
  const initial = (handle ?? '?').charAt(0).toUpperCase();
  return (
    <View
      className="items-center justify-center rounded-full bg-surface-muted"
      style={{ width: size, height: size }}
    >
      <Text className="font-semibold text-foreground" style={{ fontSize: Math.round(size * 0.4) }}>
        {initial}
      </Text>
    </View>
  );
}
