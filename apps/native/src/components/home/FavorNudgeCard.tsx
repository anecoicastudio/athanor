import { useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { useOpenNeeds } from '@/hooks/use-open-needs';
import { topOpenNeeds } from '@/lib/favor-home';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * Home block «Passa il favore» — people with an open need, and a way in (issue #99).
 *
 * This slot was an UNCONDITIONAL `ComingSoonSection` over a feature that shipped in M3. The
 * sheet, the row component, the read model, the keyset query and the IT/EN copy were all built
 * and reachable — from a footer row on the Costellazioni tab, after scrolling past every project.
 * Pay-it-forward is the mechanism this product is named for, and Home said it did not exist.
 *
 * NO PLACEHOLDER AND NO `fallback` PROP — it returns `null` and the slot collapses. That follows
 * `MomentiCard`'s «NO `fallback` PROP» note (user-approved 2026-08-11) rather than #99's literal
 * text, which asks for `favor.empty.title` here. The rule those two settled: a placeholder promises
 * a MILESTONE, so it belongs to `DreamHeroCard` and `PrimeStelleCard`, whose milestones have not
 * landed. M3 has. #177 settled that a short honest Home beats a full one made of promises, and the
 * sheet still says «Per ora hai aiutato tutti» to the member who goes looking.
 *
 * Collapsing also swallows a FAILED read, and that is a considered trade, not the #111 defect.
 * #111 is about a false claim — «you have nothing» asserted on the strength of a network error.
 * An absent block asserts nothing. The week slot beside this one gets the opposite treatment
 * (`WeekSlot.tsx`) because it reports the member's OWN Aura, where silence and a wrong number are
 * both claims about their worth; the `query.isError` arm of `(modal)/favor.tsx` owns the error copy
 * and the retry.
 *
 * ROUTE-ONLY, per `MomentiCard`'s «ROUTE-ONLY» note. `FavorRow` is deliberately NOT reused: its
 * «Aiuta» chip calls `passFavor`, and a stray tap on a scrolling Home must not be able to write.
 * The rows here are read-only; deciding happens in the sheet.
 *
 * A group of rows under its label, not a card (#921, 2026-10-05; DESIGN §6: a list is one
 * `surface` block). The rows are built here because `Row` has no leading slot for the disc:
 * `RowGroup` takes anything that brings its own vertical padding and none across. The way in,
 * «Vedi chi ha bisogno ›», stands at the right of the label as an underlined foreground
 * link; it was cyan text at the foot of the card.
 *
 * One a11y label on the Pressable, like the fund and week blocks: VoiceOver reads one node.
 * It costs the handles, a deliberate trade — `target_handle` is nullable, and a `{name}` label
 * would read the «—» fallback aloud as "dash".
 *
 * Rule #1: this reads `favor_needs` and writes nothing. Aura stays the score-engine's business.
 */
export function FavorNudgeCard({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useOpenNeeds();
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const needs = topOpenNeeds(query.data?.pages);

  // Nothing open, or nothing known yet — the slot collapses entirely (see docblock).
  if (needs.length === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.nudge.a11y', locale)}
      onPress={() => router.push('/(modal)/favor')}
      className={cn('gap-2', PRESS_DIM)}
    >
      {/* Beside each other, or stacked at the accessibility text sizes (`stacksTrailing`).
          Beside, the label takes the width that is left (`flex-1`), as in `aura/WeekCard`,
          where a label sized to its own text broke over two lines on the moto g17
          (2026-10-05; that comment has the measurement). */}
      <View className={stacked ? 'gap-1' : 'flex-row items-center justify-between gap-3'}>
        <SectionLabel className={stacked ? undefined : 'flex-1'}>
          {t('home.nudge.title', locale)}
        </SectionLabel>
        <Text className="type-small text-foreground underline">{t('home.nudge.cta', locale)}</Text>
      </View>
      <RowGroup>
        {needs.map((need) => (
          <View key={need.need_milestone_id} className="min-h-15 flex-row items-center gap-3 py-2">
            <Avatar
              handle={need.target_handle}
              displayName={need.target_display_name}
              avatarPath={need.target_avatar_path}
              size={44}
            />
            <View className="flex-1 gap-0.5">
              <Text className="type-body font-medium text-foreground" numberOfLines={1}>
                {memberLabel(need.target_display_name, need.target_handle) ?? '—'}
              </Text>
              <Text className="type-small text-muted-foreground" numberOfLines={2}>
                {need.need}
              </Text>
            </View>
          </View>
        ))}
      </RowGroup>
    </Pressable>
  );
}
