import type { ComponentProps, ReactNode } from 'react';
import { pickNextStar } from '@athanor/core';
import { t, tn } from '@athanor/i18n';
import type { Locale, Star, StarKey } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { MomentiGallery } from '@/components/media/MomentiGallery';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { SectionLabel } from '@/components/SectionLabel';
import { SixStarsGrid } from '@/components/profile/SixStarsGrid';
import { StarProgress } from '@/components/aura/StarProgress';

/**
 * Shared Profilo VIEW stack — hero → IL SOGNO → stat dot-line → Sei Stelle → Momenti
 * gallery — used by both the own tab ((tabs)/profile) and the third-person modal
 * ((modal)/user/[id]), which frontend `02` §3.5 mandates mirror each other. Divergent
 * blocks (completeness hint, Connessioni row, reviews, action bar) are injected via
 * slots/children so the layout has one source.
 *
 * #640 item 1: the dream used to render LAST (72% scroll depth measured), while DESIGN
 * §8.5 and PRD §4.2 both put it directly under identity — the dream is the product's
 * claim about a person, the stats are bookkeeping. The `dream` slot sits under the hero
 * so both surfaces move together, and the stat slab is the spec's compact dot-line
 * («Eventi 12 · …»), one muted caption instead of a display-size block outranking it.
 * Reviews stays a literal 0 until Fase 3 (no vanity counts).
 */
export function ProfileBody({
  locale,
  hero,
  statCounts,
  afterHero,
  dream,
  afterStats,
  stars,
  viewerIsOwner,
  onStarPress,
  gallery,
  children,
}: {
  locale: Locale;
  hero: ComponentProps<typeof ProfileHero>;
  statCounts?: { collabsCount: number; eventsCount: number };
  /** Slot between hero and the dream (own view: completeness hint). */
  afterHero?: ReactNode;
  /** IL SOGNO — directly under the hero on both surfaces (DESIGN §8.5, #640). */
  dream?: ReactNode;
  /** Slot between stat line and stars (own view: Connessioni row). */
  afterStats?: ReactNode;
  /** `null` = the stars read failed or has not landed — NOT «none earned» (issue #16). */
  stars: Star[] | null;
  viewerIsOwner: boolean;
  onStarPress?: (starId: StarKey) => void;
  gallery: ComponentProps<typeof MomentiGallery>;
  children?: ReactNode;
}) {
  return (
    <>
      <ProfileHero {...hero} />
      {afterHero}
      {dream}

      {/* Stat dot-line (#640): the spec's compact caption, not a display-size slab —
          «3 collaborazioni · 12 eventi · 0 recensioni». tn: «1 eventi» is a grammar
          bug — each label declares a `.one` sibling (#634). */}
      <Text className="text-center text-[13px] text-faint">
        {[
          `${statCounts?.collabsCount ?? 0} ${tn('profile.stat.collabs', statCounts?.collabsCount ?? 0, locale)}`,
          `${statCounts?.eventsCount ?? 0} ${tn('profile.stat.events', statCounts?.eventsCount ?? 0, locale)}`,
          `0 ${tn('profile.stat.reviews', 0, locale)}`,
        ].join(' · ')}
      </Text>
      {afterStats}

      {/* Le Sei Stelle — earned-only for others via RLS (rule #3); progress row is owner-only */}
      <View className="gap-3">
        <SectionLabel>{t('profile.stars.title', locale)}</SectionLabel>
        <SixStarsGrid
          stars={stars}
          viewerIsOwner={viewerIsOwner}
          locale={locale}
          onStarPress={onStarPress}
        />
        {/* Progress needs the rows to compute a ratio; with none read there is nothing truthful
            to say, so the strip hides rather than showing 0 / N. The owner gets a sentence in
            its place — six em dashes and a block that silently shrinks is honest but mute, and
            unlike the third-person case there is no «—» hero beside it co-signalling why
            (issue #16). */}
        {viewerIsOwner ? (
          stars != null ? (
            <StarProgress next={pickNextStar(stars)} locale={locale} />
          ) : (
            <Text className="text-[12px] text-faint">
              {t('profile.stars.yourUnavailable', locale)}
            </Text>
          )
        ) : null}
      </View>

      {/* Momenti gallery — own view passes onAdd; third-person passes label/emptyLabel overrides */}
      <MomentiGallery {...gallery} />

      {children}
    </>
  );
}
