import type { ReactNode } from 'react';
import { Text } from '@/tw';

/** Small-caps muted label heading a profile section (DESIGN §4 micro: 11/600). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
      {children}
    </Text>
  );
}
