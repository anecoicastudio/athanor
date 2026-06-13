import type { ReactNode } from 'react';
import { Text } from '@/tw';

/** Small-caps muted label heading a profile section. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </Text>
  );
}
