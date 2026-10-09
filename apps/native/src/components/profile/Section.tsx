import type { ReactNode } from 'react';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { Chip } from '@/components/Chip';
import { SectionLabel } from '@/components/SectionLabel';

export type Visibility = 'public' | 'members' | 'private';
export const VISIBILITY_OPTIONS: Visibility[] = ['public', 'members', 'private'];

/**
 * A labelled block of the profile editor with its visibility control: the label and the three
 * chips on one line, then the field, 8 apart, standing on the stage. No surface of its own
 * since 2026-10-05: the prototype draws the editor's fields on black, and the profile's one
 * bordered block is the dream on the view side.
 */
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
    <View className="gap-2">
      {/* Wraps twice. Three 14px chips beside a long label were wider than the block on an
          iPhone SE when it was a card (303 wide; seen on that simulator, 2026-10-04), so the
          group drops under the label; and at the largest text size the three chips are wider
          than the block by themselves, so the group wraps too. */}
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SectionLabel>{label}</SectionLabel>
        {editing ? (
          <View
            className="flex-row flex-wrap gap-1.5"
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
    </View>
  );
}
