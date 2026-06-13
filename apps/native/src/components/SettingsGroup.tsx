import type { ReactNode } from 'react';
import { View } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';

/** A titled group of settings rows inside a hairline-bordered raised surface. */
export function SettingsGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <View className="overflow-hidden rounded-card border border-hair bg-raise">{children}</View>
    </View>
  );
}
