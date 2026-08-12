import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';
import { useOpenNeeds } from '@/hooks/use-open-needs';
import { topOpenNeeds } from '@/lib/favor-home';

/**
 * Home block «Passa il favore» — people with an open need, and a way in (issue #99).
 *
 * This slot was an UNCONDITIONAL `ComingSoonSection` over a feature that shipped in M3. The
 * sheet, the row component, the read model, the keyset query and the IT/EN copy were all built
 * and reachable — from a footer row on the Costellazioni tab, after scrolling past every project.
 * Pay-it-forward is the mechanism this product is named for, and Home said it did not exist.
 *
 * NO PLACEHOLDER AND NO `fallback` PROP — it returns `null` and the slot collapses. That follows
 * `MomentiCard.tsx:20-27` (user-approved 2026-08-11) rather than #99's literal text, which asks
 * for `favor.empty.title` here. The rule those two settled: a placeholder promises a MILESTONE,
 * so it belongs to `DreamHeroCard` and `PrimeStelleCard`, whose milestones have not landed. M3
 * has. #177 settled that a short honest Home beats a full one made of promises, and the sheet
 * still says «Per ora hai aiutato tutti» to the member who goes looking.
 *
 * Collapsing also swallows a FAILED read, and that is a considered trade, not the #111 defect.
 * #111 is about a false claim — «you have nothing» asserted on the strength of a network error.
 * An absent block asserts nothing. The week slot beside this one gets the opposite treatment
 * (`WeekSlot.tsx`) because it reports the member's OWN Aura, where silence and a wrong number are
 * both claims about their worth; `(modal)/favor.tsx:123-135` owns the error copy and the retry.
 *
 * ROUTE-ONLY, per `MomentiCard.tsx:28-33`. `FavorRow` is deliberately NOT reused: its «Aiuta»
 * chip calls `passFavor`, and a stray tap on a scrolling Home must not be able to write. The
 * rows here are read-only; deciding happens in the sheet.
 *
 * Flat `Card`, no glow — navigation into a sheet is not a moment (rule #4). `costellazioni.tsx:101`
 * carries the same note on the same destination, and `favor.tsx:98-101` shows where the one glow
 * belongs: the completion overlay, after a favor is actually lit. The CTA is flat cyan text,
 * which rule #4 allows.
 *
 * The eyebrow is the default faint, NOT `tone="aura"` — `SectionLabel.tsx:11-12` warns a second
 * cyan eyebrow costs the first its rank, and Home already has two (`MomentiCard.tsx:79`,
 * `WeekCard.tsx:36`).
 *
 * One a11y label on the Pressable, like every Home sibling: VoiceOver reads one node. It costs
 * the handles, which is the same trade `MomentiCard.tsx:51-54` names — `target_handle` is
 * nullable, and a `{name}` label would read the «—» fallback aloud as "dash".
 *
 * Rule #1: this reads `favor_needs` and writes nothing. Aura stays the score-engine's business.
 */
export function FavorNudgeCard({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useOpenNeeds();
  const needs = topOpenNeeds(query.data?.pages);

  // Nothing open, or nothing known yet — the slot collapses entirely (see docblock).
  if (needs.length === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.nudge.a11y', locale)}
      onPress={() => router.push('/(modal)/favor')}
      className="gap-3"
    >
      <SectionLabel>{t('home.nudge.title', locale)}</SectionLabel>
      <Card>
        {needs.map((need) => (
          <View key={need.need_milestone_id} className="flex-row items-center gap-3">
            <Avatar handle={need.target_handle} size={40} />
            <View className="flex-1 gap-0.5">
              <Text className="text-[14px] text-foreground" numberOfLines={1}>
                {need.target_handle ?? '—'}
              </Text>
              <Text className="text-[13px] text-faint" numberOfLines={2}>
                {need.need}
              </Text>
            </View>
          </View>
        ))}
        <Text className="text-[13px] text-aura">{t('home.nudge.cta', locale)}</Text>
      </Card>
    </Pressable>
  );
}
