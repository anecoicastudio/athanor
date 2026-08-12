import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys, getAuraScore } from '@athanor/api';
import { greetingFor } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { AuraSnapshot } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { WeekCard } from '@/components/aura/WeekCard';
import { ComingSoonSection } from '@/components/home/ComingSoonSection';
import { DreamHeroCard } from '@/components/home/DreamHeroCard';
import { TodaySection } from '@/components/home/TodaySection';
import { HomeHeader } from '@/components/home/HomeHeader';
import { InviteCard } from '@/components/home/InviteCard';
import { MomentiCard } from '@/components/home/MomentiCard';
import { PrimeStelleCard } from '@/components/home/PrimeStelleCard';
import { StarsMiniRow } from '@/components/home/StarsMiniRow';
import { auraSnapshotOrNull } from '@/lib/aura-display';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { fetchWeekRecap } from '@/lib/week-recap';

/**
 * Home — the assembly host (PRD 01-m1-identity §3.2). M1 ships the shell + the
 * blocks that have real data today (greeting, stars-mini → Profilo, invite);
 * the later-milestone blocks (countdown M7, Esplora Fase2/M8, week M6, nudge M3,
 * Oggi M4) render as honest «Presto qui» placeholders in prototype order and get
 * swapped for the real block when their milestone lands.
 *
 * «Hai un Momento» (#185) is the one block with NO placeholder: it collapses to
 * nothing when no proposal waits. A placeholder promises a milestone, and this
 * one has landed — an empty deck is a fact about today, not a missing feature.
 * The tab-bar ✦ (`_layout.tsx:18-21`) is already the one-waits/none-waits signal,
 * and #177 settled that a short honest Home beats a full one made of promises.
 *
 * It sits SECOND, right after the dream hero, per DESIGN §8.2's mockup (CLAUDE.md
 * rule 4: DESIGN governs visual decisions) — not at PRD §4.4's position, which is
 * a contents list this screen has never followed for any block.
 */
export default function HomeScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const userId = session?.user.id ?? '';

  // Read-only Aura snapshot (M6 score-engine fills the values; rule #1, never client-written).
  // Shares auraKeys.score + getAuraScore with profile.tsx (one queryFn per key).
  const auraQuery = useQuery({
    queryKey: auraKeys.score(userId),
    queryFn: () => getAuraScore(supabase, userId),
    enabled: !!userId,
  });
  const aura: AuraSnapshot | null = auraSnapshotOrNull(auraQuery.data, auraQuery.isError);

  // Week recap: shared queryFn (lib/week-recap) — same key as AnalyticsLiteCard.
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(userId),
    queryFn: () => fetchWeekRecap(userId),
    enabled: !!userId,
  });

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text
          className="text-2xl text-muted-foreground"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✦
        </Text>
      </View>
    );
  }

  const locale = profile.locale;
  const greeting = t(`home.greeting.${greetingFor(new Date().getHours())}` as MessageKey, locale);

  // `messages` opens the conversations list (M5); search (M8) → search modal;
  // notifications (M9) → notification center.
  const onAction = (key: 'search' | 'messages' | 'notifications') => {
    if (key === 'search') {
      router.push('/search');
      return;
    }
    if (key === 'messages') {
      router.push('/messages');
      return;
    }
    // notifications (M9)
    router.push('/(modal)/notifications');
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-7 px-5 py-12">
      <HomeHeader greeting={greeting} handle={profile.handle} locale={locale} onAction={onAction} />
      {/* Blocks 2–6: honest placeholders until their milestone fills them in — except 2b,
          which has landed and therefore has none. */}
      {/* Block 2: M7 dream-hero — card owns the edition query; returns null when no
          active edition exists, so we show exactly one element in this slot. */}
      <DreamHeroCard
        locale={locale}
        fallback={<ComingSoonSection title={t('home.dream.title', locale)} locale={locale} />}
      />
      {/* Block 2b: «Hai un Momento» — renders only when one waits; no placeholder (see docblock). */}
      <MomentiCard locale={locale} />
      {/* Block 3: Esplora slot — Prime Stelle launch card while the flag is on (P4.2);
          honest placeholder otherwise. */}
      <PrimeStelleCard
        locale={locale}
        fallback={<ComingSoonSection title={t('home.section.explore', locale)} locale={locale} />}
      />
      {recapQuery.data != null &&
      !(recapQuery.data.auraWeek === 0 && recapQuery.data.contributi === 0) ? (
        <WeekCard recap={recapQuery.data} locale={locale} onPress={() => router.push('/recap')} />
      ) : (
        <ComingSoonSection title={t('home.week.title', locale)} locale={locale} />
      )}
      <ComingSoonSection title={t('home.nudge.title', locale)} locale={locale} />
      <TodaySection locale={locale} />

      {/* Block 7: real frame, read-only Aura snapshot → Profilo. */}
      <StarsMiniRow snapshot={aura} locale={locale} onPress={() => router.push('/profile')} />

      {/* Block 8: real invite. */}
      <InviteCard locale={locale} />
    </ScrollView>
  );
}
