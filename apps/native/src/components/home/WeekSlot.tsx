import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { View } from '@/tw';
import { WeekCard } from '@/components/aura/WeekCard';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { fetchWeekRecap } from '@/lib/week-recap';
import { weekSlotState } from '@/lib/week-slot';

/**
 * Home block «La tua settimana» — the week recap, in the four states it actually has (#100).
 *
 * It used to have one non-data branch. Loading, idle, a failed read and a genuinely quiet week
 * all rendered `ComingSoonSection` — «Presto qui» — over a feature that shipped in M6 and that
 * `(modal)/recap.tsx` renders in full three taps away. A failed read was pixel-identical to a
 * quiet week, so nobody could ever report it, and on a product whose premise is *earned*
 * reputation the message landed exactly wrong: a member who had a quiet week was told the
 * scoreboard did not exist rather than that they had not lit it yet.
 *
 * `(modal)/recap.tsx:53-118` already held the correct four-state shape for the same query; this
 * is that shape moved into the slot. #111 will likely extract a shared list-state component
 * across the ten screens with this defect — this is written to be lifted, not to pre-empt it.
 *
 * THE EYEBROW IS FAINT, NOT `tone="aura"`, even though `WeekCard.tsx:36` renders the data state's
 * eyebrow in cyan. That is not an oversight and not a thing to harmonise here: `SectionLabel.tsx:11-12`
 * warns that a second cyan eyebrow on one scroll costs the first its rank, Home already has two
 * (`WeekCard` and `MomentiCard.tsx:79`), and `WeekCard.tsx:30-34` says the fold-to-11px fix is a
 * visual decision that does not belong in a drive-by. A third would make it worse, so the three
 * non-data states keep exactly the header `ComingSoonSection` was rendering yesterday.
 *
 * NO `staleTime` — same key, same queryFn, no options, the discipline `MomentiCard.tsx:34-39`
 * documents. `AnalyticsLiteCard.tsx:34-39` already sets `staleTime: 60_000` on `auraKeys.recap`
 * while this screen and the sheet set none; that divergence predates this change and belongs with
 * #111. Adding a fourth setting on one key would only deepen it.
 *
 * The retry is `Button variant="ghost"`, NOT the `border-aura-line bg-aura-soft` pill that
 * `favor.tsx:122-127` and `costellazioni.tsx:43-48` use. That pill is the framed cyan surface
 * rule #4 reserves for moment-grade events, and #119 already counts nine copies of it as a
 * defect. A failed fetch is not a moment.
 *
 * Rule #1 is untouched: this reads the ledger and never writes it.
 */
export function WeekSlot({ locale }: { locale: Locale }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  // Shared queryFn (`lib/week-recap`) — same key as AnalyticsLiteCard and the recap sheet.
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(userId),
    queryFn: () => fetchWeekRecap(userId),
    enabled: !!userId,
  });

  const state = weekSlotState(recapQuery);
  const recap = recapQuery.data;

  // `state === 'data'` already implies `recap != null`, but that is a fact about `weekSlotState`
  // and not one the compiler can see through a string return. The guard is for tsc, not for us.
  if (state === 'data' && recap) {
    return <WeekCard recap={recap} locale={locale} onPress={() => router.push('/recap')} />;
  }

  return (
    <View className="gap-3">
      <SectionLabel>{t('home.week.title', locale)}</SectionLabel>
      <Card>
        {state === 'pending' ? (
          // `bg-raise-2` ghosts, NOT `ShimmerBar` — that component is `bg-raise` and so is
          // `Card`, so a bar inside a card is invisible. `recap.tsx:109-113` gets away with
          // ShimmerBar because its bars sit on `bg-background`; `FeedSkeleton.tsx:9-11` is the
          // in-card precedent and is where this tone comes from. (FeedSkeleton itself is not
          // reusable here: no props, three hardcoded cards, and it bakes a `px-5` that would
          // double inside Home's own `px-5` ScrollView.) Static, so reduced-motion safe.
          <View className="gap-3">
            <View className="h-5 w-full rounded-sm bg-raise-2" />
            <View className="h-5 w-2/3 rounded-sm bg-raise-2" />
          </View>
        ) : state === 'error' ? (
          <View className="items-center gap-2">
            <EmptyState>{t('aura.error', locale)}</EmptyState>
            <Button
              variant="ghost"
              label={t('common.retry', locale)}
              onPress={() => void recapQuery.refetch()}
            />
          </View>
        ) : (
          // A real quiet week. Same sentence the sheet says about the same seven days
          // (`recap.tsx:116`) — one week, one claim, and no new key for copy that exists.
          <EmptyState>{t('recap.emptyWeek', locale)}</EmptyState>
        )}
      </Card>
    </View>
  );
}
