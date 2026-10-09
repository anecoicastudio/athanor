import type { ReactNode } from 'react';
import { Text, View } from '@/tw';
import { Row } from '@/components/Row';

/**
 * One protection rule (spec §6.2): a row of the Aura screen's «Protezione del punteggio» group
 * (Galleria, 2026-10-09, #921), the shared `Row` with the rule's glyph before its title and
 * its sentence as the second line. The row does nothing, so it is not a button.
 *
 * `glyph` is a character or a drawing: a drawing where the character would be emoji-capable
 * (#753 — `ScalesGlyph`, not U+2696). The slot is a MINIMUM width, so the three titles align at
 * the default text size whichever kind each row carries, and a character glyph scaled up by
 * Dynamic Type widens its column instead of spilling into the title. Decorative on BOTH
 * platforms — the title beside it names the rule; `accessibilityElementsHidden` alone is iOS-only.
 * The glyph takes the row's ink: a rule is not one of the five cyan marks (DESIGN §2.3).
 */
export function RuleRow({ glyph, title, desc }: { glyph: ReactNode; title: string; desc: string }) {
  return (
    <Row
      leading={
        <View
          className="min-w-6 items-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {typeof glyph === 'string' ? (
            <Text className="type-body text-foreground">{glyph}</Text>
          ) : (
            glyph
          )}
        </View>
      }
      title={title}
      description={desc}
    />
  );
}
