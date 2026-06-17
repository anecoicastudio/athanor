import type { DimensionValue } from 'react-native';
import { View } from '@/tw';

/** Linear Aura-progress bar. `width` 0–1. Fill is flat `bg-aura` (no expo-linear-gradient dep). */
export function ProgressBar({ width, className }: { width: number; className?: string }) {
  const pct = `${Math.round(Math.min(1, Math.max(0, width)) * 100)}%` as DimensionValue;
  return (
    <View className={`h-1.5 overflow-hidden rounded-full bg-raise ${className ?? ''}`}>
      <View className="h-full rounded-full bg-aura" style={{ width: pct }} />
    </View>
  );
}
