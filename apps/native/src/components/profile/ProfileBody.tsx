import type { ComponentProps, ReactNode } from 'react';
import { pickNextStar } from '@athanor/core';
import { t, tn } from '@athanor/i18n';
import type { Locale, Star, StarKey } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { MomentiGallery } from '@/components/media/MomentiGallery';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { SectionLabel } from '@/components/SectionLabel';
import { SixStarsGrid } from '@/components/profile/SixStarsGrid';
import { StatLine } from '@/components/StatLine';
import { StarProgress } from '@/components/aura/StarProgress';

/**
 * Shared Profilo VIEW stack — hero → stat line → Sei Stelle → Momenti gallery — used by
 * both the own tab ((tabs)/profile) and the third-person modal ((modal)/user/[id]), which
 * frontend `02` §3.5 mandates mirror each other. Divergent blocks (completeness hint,
 * Connessioni row, dream card, reviews, action bar) are injected via slots/children so the
 * layout has one source. Reviews stat stays a literal 0 until Fase 3 (no vanity counts).
 */
export function ProfileBody({
  locale,
  hero,
  statCounts,
  afterHero,
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
  /** Slot between hero and stat line (own view: completeness hint). */
  afterHero?: ReactNode;
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

      {/* Stat line: collabs / events live (P3.1); reviews stays 0 until Fase 3.
          tn: «1 eventi» is a grammar bug — each label declares a `.one` sibling (#634). */}
      <StatLine
        items={[
          {
            value: String(statCounts?.collabsCount ?? 0),
            label: tn('profile.stat.collabs', statCounts?.collabsCount ?? 0, locale),
          },
          {
            value: String(statCounts?.eventsCount ?? 0),
            label: tn('profile.stat.events', statCounts?.eventsCount ?? 0, locale),
          },
          { value: '0', label: tn('profile.stat.reviews', 0, locale) },
        ]}
      />
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
