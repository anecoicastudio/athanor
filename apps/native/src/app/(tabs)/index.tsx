import { useRouter } from 'expo-router';
import { greetingFor } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { AuraSnapshot } from '@athanor/schemas';
import { ScrollView } from '@/tw';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Screen } from '@/components/Screen';
import { ComingSoonSection } from '@/components/home/ComingSoonSection';
import { DreamHeroCard } from '@/components/home/DreamHeroCard';
import { FavorNudgeCard } from '@/components/home/FavorNudgeCard';
import { TodaySection } from '@/components/home/TodaySection';
import { HomeHeader } from '@/components/home/HomeHeader';
import { InviteCard } from '@/components/home/InviteCard';
import { MomentiCard } from '@/components/home/MomentiCard';
import { PrimeStelleCard } from '@/components/home/PrimeStelleCard';
import { StarsMiniRow } from '@/components/home/StarsMiniRow';
import { WeekSlot } from '@/components/home/WeekSlot';
import { auraSnapshotOrNull } from '@/lib/aura-display';
import { useAuth } from '@/lib/auth-context';
import { useAuraScore } from '@/hooks/use-aura-score';

/**
 * Home — the assembly host (PRD 01-m1-identity §3.2). M1 shipped the shell in
 * prototype order and each milestone swaps its «Presto qui» placeholder for the
 * real block. ONE placeholder remains, as a `fallback` prop: Esplora Fase2/M8
 * (`PrimeStelleCard`). The countdown slot's M7 shipped, so its no-data state is a
 * real state now — `DreamHeroCard` owns it (#224): a confirmed no-cycle read
 * renders the first cycle's announcement, loading/error collapse. Everything else
 * on this screen has landed and renders real data.
 *
 * A placeholder promises a MILESTONE, so it belongs only to that one. The blocks
 * whose milestone has landed say something true about today instead, and there are
 * two shapes of that, which is deliberate:
 *
 * - «Hai un Momento» (#185), «Passa il favore» (#99) and «Oggi» (#111) COLLAPSE to
 *   nothing. An empty deck / no open need / no event today is a fact about today,
 *   not a missing feature, and silence asserts nothing. #177 settled that a short
 *   honest Home beats a full one made of promises. For Momenti the tab-bar ✦
 *   (`_layout.tsx:18-21`) is already the one-waits/none-waits signal; for the other
 *   two the modal behind the slot keeps the copy and the retry.
 * - «La tua settimana» (#100) does NOT collapse: it names which of loading, error
 *   and a genuinely quiet week it is looking at, and offers a retry on the error.
 *   It reports the member's own Aura, where a wrong or missing answer is a claim
 *   about what they have earned — see `WeekSlot.tsx` for why that reads
 *   differently from the three above.
 *
 * The dividing line, settled on #177 and recorded in DESIGN §11 2026-08-12: would a
 * missing answer say something ABOUT THE PERSON? If yes, name the state; if no,
 * collapse. Read it before adding a slot here.
 *
 * «Hai un Momento» sits SECOND, right after the dream hero, per DESIGN §8.2's mockup
 * (CLAUDE.md rule 4: DESIGN governs visual decisions) — not at PRD §4.4's position,
 * which is a contents list this screen has never followed for any block.
 */
export default function HomeScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const userId = session?.user.id ?? '';

  // Read-only Aura snapshot (M6 score-engine fills the values; rule #1, never client-written).
  const auraQuery = useAuraScore(userId);
  const aura: AuraSnapshot | null = auraSnapshotOrNull(auraQuery.data, auraQuery.isError);

  if (!profile) {
    return <LoadingScreen />;
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
    <Screen>
      <ScrollView className="flex-1" contentContainerClassName="gap-7 px-5 pb-12 pt-4">
        <HomeHeader
          greeting={greeting}
          handle={profile.handle}
          locale={locale}
          onAction={onAction}
        />
        {/* Block 2: M7 dream-hero — card owns the edition query and its states (#224):
          announcement on a confirmed no-cycle, collapse on loading/error, card when live. */}
        <DreamHeroCard locale={locale} />
        {/* Block 2b: «Hai un Momento» — renders only when one waits; no placeholder (see docblock). */}
        <MomentiCard locale={locale} />
        {/* Block 3: Esplora slot — Prime Stelle launch card while the flag is on (P4.2);
          honest placeholder otherwise. */}
        <PrimeStelleCard
          locale={locale}
          fallback={<ComingSoonSection title={t('home.section.explore', locale)} locale={locale} />}
        />
        {/* Block 4: «La tua settimana» — the card owns the recap query and says which of its four
          states it is in (#100). It used to render «Presto qui» for loading, error and a quiet
          week alike, over a feature that shipped in M6. */}
        <WeekSlot locale={locale} />
        {/* Block 5: «Passa il favore» — M3 has landed, so this is the real block. It collapses to
          nothing when no need is open, like block 2b and for the same reason (#99). */}
        <FavorNudgeCard locale={locale} />
        {/* Block 6: «Oggi» — M4 has landed. Collapses on loading, error and no events alike
          (#111), the deliberate half of that sort; `(modal)/live` owns the copy and the retry. */}
        <TodaySection locale={locale} />

        {/* Block 7: real frame, read-only Aura snapshot → Profilo. */}
        <StarsMiniRow snapshot={aura} locale={locale} onPress={() => router.push('/profile')} />

        {/* Block 8: real invite. */}
        <InviteCard locale={locale} />
      </ScrollView>
    </Screen>
  );
}
