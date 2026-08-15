import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CandidacyVote,
  type CandidateCard as CandidateCardModel,
  candidacyKeys,
  castVote,
  createContributionSession,
  fundKeys,
  getActiveEdition,
  getCandidates,
  getEditionTally,
  getFundAggregate,
  getMyVote,
  subscribeFundAggregate,
  voteKeys,
} from '@athanor/api';
import { consensusForCandidacy } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { AmountRow } from '@/components/fund/AmountRow';
import { CandidateCard, type VoteState } from '@/components/fund/CandidateCard';
import { CountdownGrid } from '@/components/fund/CountdownGrid';
import { FundTicker } from '@/components/fund/FundTicker';
import { SectionLabel } from '@/components/SectionLabel';
import { PhaseList } from '@/components/fund/PhaseList';
import { useAuth } from '@/lib/auth-context';
import { annualFundBody, fundCycleState } from '@/lib/fund-cycle';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

export default function AnnualFundScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  // ── Edition query ────────────────────────────────────────────────────────────
  const editionQuery = useQuery({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
  });

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
    onError: (_err, _candidacyId, context) => {
      qc.setQueryData(voteKeys.mine(editionId), context?.previous ?? null);
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

  // One signing call for the whole ballot, not one per card: `useSignedUrls` keys on the sorted
  // path list, so N cards signing themselves would be N requests and N cache entries for one
  // screen. Posterless candidacies contribute nothing to sign.
  const posterPaths = candidates.map((c) => c.thumb_path).filter((p): p is string => !!p);
  const { urls: posterUrls, isLoading: postersLoading } = useSignedUrls(
    'candidacy-videos',
    posterPaths,
  );

  const voteStateFor = (card: CandidateCardModel): VoteState => {
    if (edition?.winner_candidacy_id === card.candidacy_id) return 'winner';
    if (edition && edition.phase !== 'voting') return 'votingClosed';
    if (pendingCandidacyId === card.candidacy_id) return 'voting';
    if (myVote?.candidacy_id === card.candidacy_id) return 'voted';
    return 'notVoted';
  };

  // ── Contribution state + handler ─────────────────────────────────────────────
  const [amountCents, setAmountCents] = useState<number>(100); // default 1€ chip on
  const [contribPhase, setContribPhase] = useState<
    'idle' | 'opening' | 'pending' | 'canceled' | 'error'
  >('idle');

  // Clear a stale canceled/error/pending banner when the screen regains focus
  // (returning from the thank-you overlay, or navigating away and back). Never
  // clobber an in-flight `opening`.
  useFocusEffect(
    useCallback(() => {
      setContribPhase((p) => (p === 'opening' ? p : 'idle'));
    }, []),
  );

  const onContribute = useCallback(async () => {
    if (!amountCents) return;
    setContribPhase('opening');
    try {
      const { url } = await createContributionSession(supabase, {
        editionId: edition?.id ?? '',
        amountCents,
      });
      const result = await WebBrowser.openAuthSessionAsync(url, `${'athanor://'}annual`);
      if (result.type === 'success' && result.url) {
        const { queryParams } = Linking.parse(result.url);
        if (queryParams?.contrib === 'success') {
          setContribPhase('pending'); // ticker moves when the webhook lands (money = webhook cache)
          router.push('/(modal)/contribution-thanks');
          return;
        }
      }
      setContribPhase('canceled');
    } catch {
      setContribPhase('error');
    }
  }, [amountCents, edition?.id, router]);

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

        {/* 4. «Candida il tuo sogno» — flat light Button → candidacy wizard */}
        <View className="gap-2">
          <Button
            label={t('fund.candidate.cta', locale)}
            onPress={() => router.push('/(modal)/candidacy')}
            variant="light"
            // No glow — flat CTA, rule #4
          />
        </View>

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
                label={
                  contribPhase === 'opening'
                    ? t('fund.contribute.opening', locale)
                    : t('fund.contribute.cta', locale, {
                        amt: String(Math.floor(amountCents / 100)),
                      })
                }
                onPress={() => void onContribute()}
                variant="light"
                disabled={contribPhase === 'opening' || amountCents < 100}
                // Flat cyan CTA — no glow (rule #4)
              />
              {contribPhase === 'pending' ? (
                <Text className="text-[12px] text-muted-foreground">
                  {t('fund.contribute.pending', locale)}
                </Text>
              ) : null}
              {contribPhase === 'canceled' ? (
                <Text className="text-[12px] text-muted-foreground">
                  {t('fund.contribute.canceled', locale)}
                </Text>
              ) : null}
              {contribPhase === 'error' ? (
                <Text className="text-[12px] text-error">{t('fund.contribute.error', locale)}</Text>
              ) : null}
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
              {candidates.map((card) => (
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

        {/* 8. Il motore virale — cyan-wash card */}
        <View className="rounded-card border border-aura-line bg-aura-soft p-5 gap-3">
          <SectionLabel tone="aura">{t('fund.viral.label', locale)}</SectionLabel>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline1', locale)}
          </Text>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline2', locale)}
          </Text>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline3', locale)}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
