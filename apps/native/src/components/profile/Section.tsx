import type { ReactNode } from 'react';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { SectionLabel } from '@/components/SectionLabel';

export type Visibility = 'public' | 'members' | 'private';
export const VISIBILITY_OPTIONS: Visibility[] = ['public', 'members', 'private'];

/** A labelled profile block with a visibility control shown only in edit mode. */
export function Section({
  label,
  field,
  editing,
  visibility,
  setVis,
  locale,
  children,
}: {
  label: string;
  field: string;
  editing: boolean;
  visibility: Record<string, Visibility>;
  setVis: (field: string, value: Visibility) => void;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <Card>
      {/* Wraps: three 14px chips beside a long label («SEGNO ZODIACALE») are wider than the card
          on an iPhone SE, where the last chip was cut at the card's edge (2026-10-04). */}
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SectionLabel>{label}</SectionLabel>
        {editing ? (
          <View
            className="flex-row gap-1.5"
            accessibilityRole="radiogroup"
            accessibilityLabel={t('profile.visibility.label', locale)}
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                role="radio"
                label={t(`visibility.${opt}` as MessageKey, locale)}
                selected={(visibility[field] ?? 'members') === opt}
                onPress={() => setVis(field, opt)}
              />
            ))}
          </View>
        ) : null}
      </View>
      {children}
    </Card>
  );
}
