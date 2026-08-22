import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CandidacyVote,
  type CandidateCard as CandidateCardModel,
  type RealizationUpdateCursor,
  candidacyKeys,
  castVote,
  fundKeys,
  getCandidates,
  getEditionTally,
  getFundAggregate,
  getMyCandidacy,
  getMyLatestPriorCandidacy,
  getMyVote,
  getRealizationPlan,
  getRealizationPlanPhases,
  getRealizationUpdates,
  realizationPlanKeys,
  realizationUpdateKeys,
  subscribeFundAggregate,
  voteKeys,
} from '@athanor/api';
import { MIN_CONTRIBUTION_CENTS, consensusForCandidacy, isBallotOpen } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { AmountRow } from '@/components/fund/AmountRow';
import { BallotFilterChips } from '@/components/fund/BallotFilterChips';
import { CandidateCard, type VoteState } from '@/components/fund/CandidateCard';
import { CountdownGrid } from '@/components/fund/CountdownGrid';
import { FundTicker } from '@/components/fund/FundTicker';
import { SectionLabel } from '@/components/SectionLabel';
import { PhaseList } from '@/components/fund/PhaseList';
import { ProgressUpdateCard } from '@/components/fund/ProgressUpdateCard';
import { ViralCard } from '@/components/fund/ViralCard';
import { useAuth } from '@/lib/auth-context';
import {
  type BallotFilter,
  ballotFilters,
  filterCandidates,
  resolveFilter,
} from '@/lib/ballot-card';
import { annualFundBody, fundCycleState } from '@/lib/fund-cycle';
import { castVoteError } from '@/lib/vote-error';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useActiveEdition } from '@/hooks/use-active-edition';
import { useLocale } from '@/hooks/use-locale';

export default function AnnualFundScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  // ── Edition query ────────────────────────────────────────────────────────────
  const editionQuery = useActiveEdition();

  const edition = editionQuery.data ?? null;

  // ── Aggregate query (only when edition exists) ───────────────────────────────
  const qc = useQueryClient();
  const aggregateQuery = useQuery({
    queryKey: fundKeys.aggregate(edition?.id ?? ''),
    queryFn: () => getFundAggregate(supabase, edition!.id),
    enabled: !!edition?.id,
  });

  // ── Realtime subscription (fund ticker) ─────────────────────────────────────
  const [live, setLive] = useState(false);

  useEffect(() => {
    const editionId = edition?.id;
    if (!editionId) return;

    const cleanup = subscribeFundAggregate(
      supabase,
      editionId,
      (agg) => qc.setQueryData(fundKeys.aggregate(editionId), agg),
      (status) => setLive(status === 'SUBSCRIBED'),
    );

    return cleanup;
  }, [edition?.id, qc]);

  // Flatten aggregate values (0 when null / not yet arrived)
  const agg = aggregateQuery.data ?? null;
  const raisedCents = agg?.raised_cents ?? 0;
  const contributorCount = agg?.contributor_count ?? 0;
  const goalCents = edition?.goal_cents ?? 0;

  // ── Voting: candidates + tally + my vote ────────────────────────────────────
  const editionId = edition?.id ?? '';
  const uid = profile?.id;

  const candidatesQuery = useQuery({
    queryKey: candidacyKeys.list(editionId),
    queryFn: () => getCandidates(supabase, { editionId }),
    enabled: !!editionId,
  });
  const tallyQuery = useQuery({
    queryKey: voteKeys.tally(editionId),
    queryFn: () => getEditionTally(supabase, editionId),
    enabled: !!editionId,
  });
  const myVoteQuery = useQuery({
    queryKey: voteKeys.mine(editionId),
    queryFn: () => getMyVote(supabase, editionId, uid!),
    enabled: !!editionId && !!uid,
  });
  // Own candidacy (one per edition) — drives the explicit edit/resubmit entry (#226).
  const myCandidacyQuery = useQuery({
    queryKey: candidacyKeys.mine(editionId),
    queryFn: () => getMyCandidacy(supabase, editionId, uid!),
    enabled: !!editionId && !!uid,
  });
  const myCandidacy = myCandidacyQuery.data ?? null;
  // FUND-35's cross-cycle half (#221): a candidacy in a closed prior cycle offers the
  // explicit prefilled re-submission — fetched only once this cycle is known to have none.
  const priorCandidacyQuery = useQuery({
    queryKey: candidacyKeys.priorMine(editionId),
    queryFn: () => getMyLatestPriorCandidacy(supabase, editionId, uid!),
    enabled: !!editionId && !!uid && myCandidacyQuery.isSuccess && !myCandidacyQuery.data,
  });
  const priorCandidacy = priorCandidacyQuery.data ?? null;

  // Refetch the tally on focus — others' votes don't stream (own-row RLS), so
  // there's no realtime subscription here; the % refreshes on focus + on a vote.
  useFocusEffect(
    useCallback(() => {
      if (editionId) qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
    }, [editionId, qc]),
  );

  // Vote mutation — optimistic flip of `voteKeys.mine` to the tapped candidacy,
  // rolled back on error. Invalidates mine + tally on settle.
  const voteMutation = useMutation({
    mutationFn: (candidacyId: string) => castVote(supabase, { editionId, candidacyId }),
    onMutate: async (candidacyId: string) => {
      const key = voteKeys.mine(editionId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CandidacyVote | null>(key);
      // Optimistic placeholder: only candidacy_id drives the «Votato ✦» flip.
      qc.setQueryData<CandidacyVote | null>(key, (old) =>
        old
          ? { ...old, candidacy_id: candidacyId }
          : ({
              id: '',
              edition_id: editionId,
              candidacy_id: candidacyId,
              voter_id: uid ?? '',
              weight: 0,
              created_at: new Date().toISOString(),
            } satisfies CandidacyVote),
      );
      return { previous };
    },
    onError: (err, _candidacyId, context) => {
      qc.setQueryData(voteKeys.mine(editionId), context?.previous ?? null);
      // #382: the rollback used to be the WHOLE error path, so a server refusal was
      // indistinguishable from a tap that never landed — the card flipped back and said
      // nothing. The ballot is a list, with no per-card slot for a sentence, so the Alert is
      // the surface here; the detail screen has room and renders its message inline.
      const { key, editionStale } = castVoteError(err);
      Alert.alert(t(key, locale));
      // 'voting closed' means the cached edition is wrong (the window moved, or was never
      // published). Re-read it so the ballot flips to its real state instead of arguing.
      if (editionStale) void qc.invalidateQueries({ queryKey: fundKeys.activeEdition() });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: voteKeys.mine(editionId) });
      qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
    },
  });

  const myVote = myVoteQuery.data ?? null;
  const tally = tallyQuery.data ?? [];
  const pendingCandidacyId = voteMutation.isPending ? (voteMutation.variables ?? null) : null;

  const onVote = useCallback(
    (card: CandidateCardModel) => {
      const move = !!myVote && myVote.candidacy_id !== card.candidacy_id;
      if (move) {
        Alert.alert(t('fund.vote.oneOnly', locale), undefined, [
          { text: t('common.cancel', locale), style: 'cancel' },
          {
            text: t('fund.vote.cta', locale),
            onPress: () => voteMutation.mutate(card.candidacy_id),
          },
        ]);
      } else {
        voteMutation.mutate(card.candidacy_id);
      }
    },
    [myVote, locale, voteMutation],
  );

  const candidates = candidatesQuery.data?.items ?? [];

  // Ballot category filter (#227, FUND-11/D43). Client-side on purpose: the page is already
  // in hand (one keyset page of ~20), so filtering here costs nothing and — unlike a server
  // `eq('category', …)` — cannot interact with the cursor. Pushing it into the query would
  // mean a cursor per filter and a page that shrinks as the member taps.
  const [ballotFilter, setBallotFilter] = useState<BallotFilter>('all');
  const filters = useMemo(() => ballotFilters(candidates), [candidates]);
  const activeFilter = resolveFilter(filters, ballotFilter);
  const visibleCandidates = useMemo(
    () => filterCandidates(candidates, activeFilter),
    [candidates, activeFilter],
  );

  // #229: the cycle's declared winner, after their viability confirmation (#220).
  const isPlanAuthor =
    !!edition?.winner_candidacy_id &&
    !!myCandidacy &&
    edition.winner_candidacy_id === myCandidacy.id &&
    edition.winner_confirmed_at !== null;

  // ── The progress trail (#230, FUND-26) ──────────────────────────────────────
  // Realization is the phase this exists for: before it there is no published commitment to
  // report against, and a closed cycle no longer appears on this screen at all. Keyset, not
  // offset (rule #9) — the winner posts while the community reads.
  const realizing = edition?.phase === 'realization';
  const updatesPage = useInfiniteQuery({
    queryKey: realizationUpdateKeys.feed(editionId),
    queryFn: ({ pageParam }) =>
      getRealizationUpdates(supabase, editionId, {
        cursor: pageParam as RealizationUpdateCursor | null,
      }),
    initialPageParam: null as RealizationUpdateCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!editionId && realizing,
  });
  const updates = useMemo(
    () => updatesPage.data?.pages.flatMap((p) => p.rows) ?? [],
    [updatesPage.data],
  );

  // The published plan's phases, so a note that names one reads as «Fase 2 · allestimento»
  // rather than as an id. Public: RLS serves these to anon once the plan is published.
  const publicPlanQuery = useQuery({
    queryKey: realizationPlanKeys.byEdition(editionId),
    queryFn: () => getRealizationPlan(supabase, editionId),
    enabled: !!editionId && realizing,
  });
  const publicPlan = publicPlanQuery.data ?? null;
  const publicPhasesQuery = useQuery({
    queryKey: realizationPlanKeys.phases(publicPlan?.id ?? ''),
    queryFn: () => getRealizationPlanPhases(supabase, publicPlan!.id),
    enabled: !!publicPlan?.id,
  });
  const publicPhases = useMemo(() => publicPhasesQuery.data ?? [], [publicPhasesQuery.data]);
  // Pinned per render pass so every «2 ore fa» in one list agrees with the others.
  const nowMs = useRef(Date.now()).current;

  // One signing call for the whole ballot, not one per card: `useSignedUrls` keys on the sorted
  // path list, so N cards signing themselves would be N requests and N cache entries for one
  // screen. Posterless candidacies contribute nothing to sign.
  const posterPaths = candidates.map((c) => c.thumb_path).filter((p): p is string => !!p);
  const { urls: posterUrls, isLoading: postersLoading } = useSignedUrls(
    'candidacy-videos',
    posterPaths,
  );

  /**
   * The per-card action state. The ballot rule comes from `isBallotOpen` (`@athanor/core`), which
   * mirrors `cast_vote` — phase AND the window — instead of the phase alone (#382). The window
   * columns were already in hand: `getActiveEdition` is `select('*')`, so this screen fetched
   * `voting_starts_at` / `voting_ends_at` and ignored them, and a `voting` cycle outside its
   * window (or with the window never published, #414) rendered «Vota» over a vote the server
   * refuses. A NULL window is treated as shut, exactly as the SQL treats it.
   *
   * `nowMs` is pinned per render pass (above), so a window that closes while the screen sits
   * open is not caught here — that residual race is what the mutation's error copy is for.
   */
  const voteStateFor = (card: CandidateCardModel): VoteState => {
    if (edition?.winner_candidacy_id === card.candidacy_id) return 'winner';
    if (edition && !isBallotOpen(edition, nowMs)) return 'votingClosed';
    if (pendingCandidacyId === card.candidacy_id) return 'voting';
    if (myVote?.candidacy_id === card.candidacy_id) return 'voted';
    return 'notVoted';
  };

  // ── Contribution amount (payment itself lives behind the disclosure, #235) ──
  // Defaults to the floor: the smallest chip is the one selected on open.
  const [amountCents, setAmountCents] = useState<number>(MIN_CONTRIBUTION_CENTS);

  // FUND-18: the CTA never opens a payment — it pushes the blocking disclosure
  // screen, which is the app's ONLY call site of createContributionSession
  // (pinned by fund-disclosure.test.ts). The window-refusal handling from #222
  // moved there with the payment launch.
  const onContribute = useCallback(() => {
    if (amountCents < MIN_CONTRIBUTION_CENTS) return;
    router.push({
      pathname: '/(modal)/fund-disclosure',
      params: { amount: String(amountCents) },
    });
  }, [amountCents, router]);

  // ── Pending / error / no-cycle bodies (state selection: lib/fund-cycle.ts, #224) ──
  const body = annualFundBody(
    fundCycleState({
      status: editionQuery.status,
      fetchStatus: editionQuery.fetchStatus,
      edition,
    }),
  );

  if (body === 'loading') {
    return (
      <Screen>
        <ModalHeader title={t('fund.title', locale)} backLabel={t('common.back', locale)} />
        {/* Skeleton / quiet placeholder */}
        <View className="flex-1 items-center justify-center gap-4 px-5">
          <ActivityIndicator color={semantic.aura} />
          <Text className="text-[13px] text-muted-foreground">— — —</Text>
        </View>
      </Screen>
    );
  }

  // A failed read is NOT «no cycle» — it gets the retry, never the announcement (#224).
  if (body === 'error') {
    return (
      <Screen>
        <ModalHeader title={t('fund.title', locale)} backLabel={t('common.back', locale)} />
        <View className="flex-1 items-center justify-center gap-2 px-5">
          <EmptyState>{t('fund.error', locale)}</EmptyState>
          <Button
            label={t('common.retry', locale)}
            variant="ghost"
            onPress={() => void editionQuery.refetch()}
          />
        </View>
      </Screen>
    );
  }

  // ── No active cycle — the announcement, not an absence (FUND-47, FUND-SPEC §6) ──
  if (body === 'announce' || !edition) {
    return (
      <Screen>
        <ModalHeader title={t('fund.title', locale)} backLabel={t('common.back', locale)} />
        <View className="flex-1 items-center justify-center gap-6 px-5">
          {/* Same brand-voice hero the live screen opens with — flat cyan text, no glow */}
          <Text className="text-center text-[15px] leading-6 text-aura">
            {t('fund.hero.quote', locale)}
          </Text>
          <FundTicker noCycle locale={locale} />
        </View>
      </Screen>
    );
  }

  // ── Live screen (full composition) ──────────────────────────────────────────
  return (
    <Screen>
      {/* 1. Header — back chevron + fund.title */}
      <ModalHeader title={t('fund.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-16">
        {/* 2. Hero quote — brand voice, cyan (NOT Hanken-italic dream register) */}
        <Text className="text-center text-[15px] leading-6 text-aura">
          {t('fund.hero.quote', locale)}
        </Text>

        {/* 3. Hero countdown block */}
        <View className="gap-4">
          <SectionLabel>{t('fund.countdown.label', locale)}</SectionLabel>
          <CountdownGrid targetMs={Date.parse(edition.target_at)} locale={locale} />
          <FundTicker
            raisedCents={raisedCents}
            contributorCount={contributorCount}
            goalCents={goalCents}
            live={live}
            locale={locale}
          />
        </View>

        {/* 4. «Candida il tuo sogno» — flat light Button → candidacy wizard. One candidacy
            per edition (dream_candidacies_one_per_edition), so an existing row replaces the
            CTA; while it is still 'submitted' (the RLS update window) and the window is open,
            the member can EXPLICITLY reopen the wizard prefilled (#226 — never automatic). */}
        <View className="gap-2">
          {!myCandidacy ? (
            <>
              <Button
                label={t('fund.candidate.cta', locale)}
                onPress={() => router.push('/(modal)/candidacy')}
                variant="light"
                // No glow — flat CTA, rule #4
              />
              {/* FUND-35 cross-cycle (#221): a prior-cycle candidacy offers the EXPLICIT
                  prefilled restart — a fresh row in this cycle, never an auto-carry. */}
              {priorCandidacy ? (
                <>
                  <Button
                    label={t('candidacy.resubmit.cta', locale)}
                    onPress={() =>
                      router.push({ pathname: '/(modal)/candidacy', params: { resubmit: '1' } })
                    }
                    variant="ghost"
                  />
                  <Text className="text-center text-[12px] text-muted-foreground">
                    {t('candidacy.resubmit.hint', locale)}
                  </Text>
                </>
              ) : null}
            </>
          ) : (
            <>
              {myCandidacy.status !== 'rejected' ? (
                <Text className="text-center text-[13px] text-muted-foreground">
                  {t('candidacy.success.eyebrow', locale)}
                </Text>
              ) : null}
              {myCandidacy.status === 'submitted' && edition.candidacy_window_open ? (
                <Button
                  label={t('candidacy.edit.cta', locale)}
                  onPress={() =>
                    router.push({ pathname: '/(modal)/candidacy', params: { edit: '1' } })
                  }
                  variant="ghost"
                />
              ) : null}
            </>
          )}
        </View>

        {/* 4b. The winner's realization plan (#229). Shown only to the member whose
            candidacy won AND who has confirmed the dream is deliverable at the snapshotted
            figure (#220) — that confirmation is what #228's trigger requires before a plan
            can exist. Everyone else's cycle has nothing to author here, so the block is
            absent rather than disabled. */}
        {isPlanAuthor ? (
          <View className="gap-2">
            <Button
              label={t('fund.plan.entry.cta', locale)}
              onPress={() => router.push('/(modal)/plan')}
              variant="light"
            />
            <Text className="text-center text-[12px] text-muted-foreground">
              {t('fund.plan.entry.hint', locale)}
            </Text>
          </View>
        ) : null}

        {/* 4c. Aggiornamenti dal sogno (#230, FUND-26) — the ongoing trail, public to
            everyone including the signed-out web page (#237) that reads the same rows.
            No reaction count and no view count anywhere in it (rule #3): the community
            follows the project, it does not score it. */}
        {realizing ? (
          <View className="gap-3">
            <SectionLabel>{t('fund.progress.title', locale)}</SectionLabel>
            <Text className="text-[14px] leading-5 text-foreground">
              {t('fund.progress.lead', locale)}
            </Text>

            {/* The winner's way in. Shown above their own trail because writing is why they
                opened this screen; everyone else sees the section without it. */}
            {isPlanAuthor ? (
              <View className="gap-2">
                <Button
                  label={t('fund.progress.compose.entry.cta', locale)}
                  onPress={() => router.push('/(modal)/progress')}
                  variant="light"
                  // Flat cyan CTA — no glow (rule #4)
                />
                <Text className="text-center text-[12px] text-muted-foreground">
                  {t('fund.progress.compose.entry.hint', locale)}
                </Text>
              </View>
            ) : null}

            {updatesPage.isLoading ? (
              <ActivityIndicator color={semantic.aura} />
            ) : updates.length === 0 ? (
              <Text className="text-[14px] text-muted-foreground">
                {t('fund.progress.empty', locale)}
              </Text>
            ) : (
              <View className="gap-4">
                {updates.map((update) => (
                  <ProgressUpdateCard
                    key={update.id}
                    update={update}
                    phase={publicPhases.find((p) => p.id === update.plan_phase_id) ?? null}
                    locale={locale}
                    now={nowMs}
                  />
                ))}
                {updatesPage.hasNextPage ? (
                  <Button
                    label={t('fund.progress.more', locale)}
                    onPress={() => void updatesPage.fetchNextPage()}
                    variant="ghost"
                    disabled={updatesPage.isFetchingNextPage}
                  />
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        {/* 5. Partecipa */}
        <View className="gap-3">
          <SectionLabel>{t('fund.contribute.title', locale)}</SectionLabel>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.contribute.intro', locale)}
          </Text>

          {edition.contributions_enabled ? (
            <View className="gap-3">
              <AmountRow
                amountCents={amountCents}
                onChange={(c) => setAmountCents(c ?? 0)}
                locale={locale}
              />
              <Button
                label={t('fund.contribute.cta', locale, {
                  amt: String(Math.floor(amountCents / 100)),
                })}
                onPress={onContribute}
                variant="light"
                disabled={amountCents < MIN_CONTRIBUTION_CENTS}
                // Flat cyan CTA — no glow (rule #4)
              />
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.contribute.zeroAura', locale)}
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              <Button
                label={t('fund.contribute.soon', locale)}
                onPress={() => {}}
                variant="ghost"
                disabled
              />
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.contribute.soonNote', locale)}
              </Text>
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.contribute.zeroAura', locale)}
              </Text>
            </View>
          )}
        </View>

        {/* 6. Sogni candidati — live candidate cards (voting slice).
            Realtime tally is DEFERRED (own-row RLS can't stream others' votes);
            the consensus % refreshes on focus + after a vote. */}
        <View className="gap-3">
          <SectionLabel>{t('fund.candidates.title', locale)}</SectionLabel>
          {candidatesQuery.isLoading ? (
            <ActivityIndicator color={semantic.aura} />
          ) : candidates.length === 0 ? (
            <Text className="text-[14px] text-muted-foreground">
              {t('fund.candidates.empty', locale)}
            </Text>
          ) : (
            <View className="gap-4">
              {/* Category filter (#227). No empty state under it by construction: the chips
                  offer only categories this ballot carries, so a tap always leaves cards. */}
              <BallotFilterChips
                filters={filters}
                active={activeFilter}
                onChange={setBallotFilter}
                locale={locale}
              />
              {visibleCandidates.map((card) => (
                <CandidateCard
                  key={card.candidacy_id}
                  card={card}
                  posterUrl={card.thumb_path ? posterUrls[card.thumb_path] : undefined}
                  isLoadingPoster={postersLoading}
                  consensus={consensusForCandidacy(tally, card.candidacy_id)}
                  voteState={voteStateFor(card)}
                  locale={locale}
                  onVote={() => onVote(card)}
                  onOpen={() => router.push(`/(modal)/candidacy/${card.candidacy_id}`)}
                />
              ))}
            </View>
          )}
        </View>

        {/* 7. Come vengono scelti */}
        <View className="gap-3">
          <SectionLabel>{t('fund.howChosen.title', locale)}</SectionLabel>
          <PhaseList current={edition.phase} locale={locale} />
        </View>

        {/* 8. Il motore virale — cyan-wash card, now carrying the referral share (#242) */}
        <ViralCard locale={locale} />
      </ScrollView>
    </Screen>
  );
}
