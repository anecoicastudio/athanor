import type { ReactNode } from 'react';
import { Text, View } from '@/tw';

/**
 * Empty-state motif: the ✦ spark glyph (DESIGN.md spark vocabulary) over a quiet
 * line of guidance. Muted so it reads as absence, not a moment.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <View className="items-center gap-2 py-4">
      <Text className="text-2xl text-faint">✦</Text>
      <Text className="text-center text-faint">{children}</Text>
    </View>
  );
}
