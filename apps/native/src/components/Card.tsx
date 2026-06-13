import type { ReactNode } from 'react';
import { View } from '@/tw';

/** Section container for a labelled profile block. */
export function Card({ children }: { children: ReactNode }) {
  return <View className="gap-3 rounded-card border border-hair bg-raise p-5">{children}</View>;
}
