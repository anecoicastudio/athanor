import type { DimensionValue } from 'react-native';
import { View } from '@/tw';

/** Linear progress bar (DESIGN §3): a 4pt hairline-coloured track, foreground fill. `width` 0–1. */
export function ProgressBar({ width, className }: { width: number; className?: string }) {
  const pct = `${Math.round(Math.min(1, Math.max(0, width)) * 100)}%` as DimensionValue;
  return (
    <View className={`h-1 overflow-hidden rounded-full bg-hair ${className ?? ''}`}>
      <View className="h-full rounded-full bg-foreground" style={{ width: pct }} />
    </View>
  );
}
