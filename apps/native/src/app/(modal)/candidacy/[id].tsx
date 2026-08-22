import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  candidacyKeys,
  castVote,
  fundKeys,
  getCandidateById,
  getEditionTally,
  getMyVote,
  signMediaUrls,
  voteKeys,
} from '@athanor/api';
import { consensusForCandidacy, formatFundTotal } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t, tagLabel, type MessageKey } from '@athanor/i18n';
import { VoteBar } from '@/components/fund/VoteBar';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { authorParts, categoryLabel, confirmedHistory } from '@/lib/ballot-card';
import { candidacyBallotOpen, detailVoteState } from '@/lib/fund-cycle';
import { castVoteError } from '@/lib/vote-error';
import { SectionLabel } from '@/components/SectionLabel';
import { Tag } from '@/components/Tag';
import { ListState } from '@/components/ListState';
import { MediaFrame } from '@/components/media/MediaFrame';
import { ModalHeader } from '@/components/ModalHeader';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { useVideoFailure } from '@/lib/media/use-video-failure';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useActiveEdition } from '@/hooks/use-active-edition';

/**
 * Candidate detail (M7 §3.4). Honest MVP: a signed-URL video player + title +
 * author line + the consensus <VoteBar> + the same Vota/Votato/Voto-chiuso
 * action & mutation as the card. Fetches via `getCandidateById` so deep links
 * work. Reduced-motion safe — no entrance animation here; the player only
 * autoplays muted on a loop.
 *
 * #382 made the «Voto chiuso» claim above true. This screen queried the candidacy, the tally and
 * the member's own vote, but never the EDITION — so it knew neither the phase nor the ballot
 * window, `votingClosed` was unreachable, and the docblock had been describing a state that could
 * not render. It now reads `fundKeys.activeEdition()` (warmed by annual.tsx in the normal flow,
 * refetched on a direct deep link, exactly as fund-disclosure.tsx does) and puts the answer
 * through `candidacyBallotOpen` + `detailVoteState`. Its mutation also had no `onError` at all,
 * so a refusal from `cast_vote` was indistinguishable from a tap that never registered; there is
 * room for a sentence on this screen, so the message renders inline.
 *
 * #227 adds what the card has no room for: both money figures WITH the sentence
 * D11 requires beside the minimum (ballot information, never the shortfall gate
 * — that is FUND-42), the linked dream's confirmed history in full, and the
 * skills the dream needs. All three come off the same `fund_candidate_cards`
 * row, so this is still one query.
 *
 * DEFERRED: story / goal / impact — the `fund_candidate_cards` view doesn't
 * carry them, so showing them would need a second query against
 * `dream_candidacies`; left out of this slice (see task report). #227 did NOT
 * fold them in: they are long-form prose, not ballot figures, and adding four
 * text columns to a view every ballot row pays for is a different trade.
 */
export default function CandidacyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id;
  const qc = useQueryClient();

  const cardQuery = useQuery({
    queryKey: candidacyKeys.detail(id),
    queryFn: () => getCandidateById(supabase, id),
    enabled: !!id,
  });
  const card = cardQuery.data ?? null;
  const editionId = card?.edition_id ?? '';

  // Signed URL for the private candidacy-videos bucket (mirror Lightbox/media lib).
  const videoQuery = useQuery({
    queryKey: ['signed-media', 'candidacy-videos', card?.video_url ?? ''],
    queryFn: () => signMediaUrls(supabase, 'candidacy-videos', [card!.video_url]),
    enabled: !!card?.video_url,
    staleTime: 50 * 60 * 1000, // under the 1h signed-URL expiry
    // Never persisted (#287): the URL dies at the 1h TTL, the persisted cache lives 24h.
    meta: { persist: false },
  });
  const videoUrl = card ? videoQuery.data?.[card.video_url] : undefined;

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
  // The cycle itself (#382) — the phase and the ballot window this screen used to render its
  // action without. Unconditional and un-keyed by id because `getActiveEdition` is the only
  // getter there is; `candidacyBallotOpen` is what reconciles it with `card.edition_id`.
  const editionQuery = useActiveEdition();
  // Pinned per render pass, like annual.tsx: a window that closes while the screen sits open is
  // not caught here, and that residual race is what the refusal copy below is for.
  const nowMs = useRef(Date.now()).current;

  // Refetch the tally on focus — others' votes don't stream (own-row RLS).
  useFocusEffect(
    useCallback(() => {
      if (editionId) {
        qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
      }
    }, [editionId, qc]),
  );

  // #382: the vote path had NO error handling. «No toast host; the state is the feedback» was
  // the stated reason, but the state fed back nothing — `isPending` cleared and the action
  // returned to «Vota», which is what a tap that never fired also looks like. The state now
  // carries the sentence.
  const [voteErrorKey, setVoteErrorKey] = useState<MessageKey | null>(null);

  const vote = useMutation({
    mutationFn: () => castVote(supabase, { editionId, candidacyId: id }),
    onMutate: () => setVoteErrorKey(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: voteKeys.mine(editionId) });
      qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
    },
    onError: (err) => {
      const { key, editionStale } = castVoteError(err);
      setVoteErrorKey(key);
      // 'voting closed' means the cached edition is wrong — re-read it so the action flips to
      // «Voto chiuso» instead of inviting the same refusal again.
      if (editionStale) void qc.invalidateQueries({ queryKey: fundKeys.activeEdition() });
    },
  });

  const myVote = myVoteQuery.data ?? null;
  const tally = tallyQuery.data ?? [];

  const onVote = useCallback(() => {
    if (!card) return;
    const move = !!myVote && myVote.candidacy_id !== card.candidacy_id;
    if (move) {
      Alert.alert(t('fund.vote.oneOnly', locale), undefined, [
        { text: t('common.cancel', locale), style: 'cancel' },
        { text: t('fund.vote.cta', locale), onPress: () => vote.mutate() },
      ]);
    } else {
      vote.mutate();
    }
  }, [card, myVote, locale, vote]);

  // ── Loading / error / not-found ───────────────────────────────────────────
  // `!card` used to be all three at once, and the sentence it rendered was
  // `fund.candidates.empty` — «I sogni candidati appariranno qui», a LIST's empty state on a
  // DETAIL screen, said equally to someone whose network dropped and someone who followed a
  // dead deep link (#111). Three situations, three answers.
  const detailState = listState({
    status: cardQuery.status,
    fetchStatus: cardQuery.fetchStatus,
    isEmpty: card == null,
    staleWins: true,
  });
  // The `card == null` half is what narrows `card` for everything below; `listState` only
  // returns 'ready' when `isEmpty` is false, but the compiler cannot see that through the call.
  if (detailState !== 'ready' || card == null) {
    return (
      <FundChrome locale={locale}>
        <View className="flex-1 items-center justify-center">
          <ListState
            state={detailState}
            locale={locale}
            errorLabel={t('fund.candidacy.error', locale)}
            emptyLabel={t('fund.candidacy.notFound', locale)}
            onRetry={() => void cardQuery.refetch()}
            className="px-5"
            loading={<ActivityIndicator color={semantic.aura} />}
          />
        </View>
      </FundChrome>
    );
  }

  const consensus = consensusForCandidacy(tally, card.candidacy_id);
  const voteState = detailVoteState({
    ballotOpen: candidacyBallotOpen({
      status: editionQuery.status,
      edition: editionQuery.data ?? null,
      candidacyEditionId: card.edition_id,
      nowMs,
    }),
    pending: vote.isPending,
    votedThis: myVote?.candidacy_id === card.candidacy_id,
  });
  const title = card.title ?? card.category ?? '';
  const author = authorParts({
    handle: card.handle,
    city: card.city,
    categoryLabel: categoryLabel(card.category, locale),
  }).join(' · ');
  const history = confirmedHistory(card);

  return (
    <FundChrome locale={locale}>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-16">
        {/* Player — through MediaFrame (#278): the old bare `videoUrl ? player : ▶` rendered
            "still signing", "never coming" and "died after signing" as the same static ▶, the
            #135 conflation rebuilt on a new surface. */}
        <View className="aspect-video w-full overflow-hidden rounded-card bg-raise-2">
          <MediaFrame
            kind="video"
            url={videoUrl}
            isLoading={videoQuery.isLoading}
            locale={locale}
            className="absolute inset-0"
          >
            {(uri, onFailure) => <DetailVideo uri={uri} onError={onFailure} />}
          </MediaFrame>
        </View>

        {/* Title + author */}
        <View className="gap-1">
          <Text className="text-xl leading-7 text-foreground">{title}</Text>
          <Text className="text-[13px] text-muted-foreground">{author}</Text>
        </View>

        {/* What the vote is about (#227, FUND-09 / D10-D11). Both figures, then the sentence
            D11 requires: the minimum is BALLOT INFORMATION, never the shortfall gate — that
            is FUND-42's per-cycle floor plus the winner's viability confirmation. The schema
            comment on min_viable_cents says exactly this; the copy has to say it too, or the
            number silently reads as a threshold the campaign must clear. */}
        <View className="gap-2 rounded-card border border-hair bg-raise p-4">
          <View className="flex-row flex-wrap gap-x-6 gap-y-2">
            <View className="gap-0.5">
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.candidate.budget', locale)}
              </Text>
              <Text className="text-[18px] text-foreground">
                {formatFundTotal(card.budget_cents, locale)}
              </Text>
            </View>
            <View className="gap-0.5">
              <Text className="text-[12px] text-muted-foreground">
                {t('fund.candidate.minViable', locale)}
              </Text>
              <Text className="text-[18px] text-foreground">
                {formatFundTotal(card.min_viable_cents, locale)}
              </Text>
            </View>
          </View>
          <Text className="text-[12px] leading-4 text-muted-foreground">
            {t('fund.candidate.minViable.note', locale)}
          </Text>
        </View>

        {/* The linked dream's confirmed history (#227, FUND-50/D12) — the strongest signal a
            voter can have, and the one aligned with reputation earned through real action.
            Quiet by construction: hairline + raise, never the aura-soft/glow recipe. Nothing
            moment-grade happened here; work was done, and rule #4 reserves the glow for the
            moment. Collapses whole when nothing is confirmed. */}
        {history ? (
          <View className="gap-2">
            <SectionLabel>{t('fund.candidate.history.title', locale)}</SectionLabel>
            <View className="gap-1 rounded-card border border-hair bg-raise p-4">
              <Text className="text-[14px] text-foreground">
                {t('fund.candidate.history.milestones', locale, { n: history.milestones })}
              </Text>
              <Text className="text-[14px] text-foreground">
                {t('fund.candidate.history.helps', locale, { n: history.helps })}
              </Text>
              <Text className="mt-1 text-[12px] text-muted-foreground">
                {t('fund.candidate.history.note', locale)}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Skills the dream needs (#225 FUND-10/D13) — static Tags, the payload of their own
            section, so the default (foreground) tone. They live here rather than on the card
            because ten of them wrap into a cloud a list card has no room for. */}
        {card.skills_needed.length > 0 ? (
          <View className="gap-2">
            <SectionLabel>{t('fund.candidate.skills', locale)}</SectionLabel>
            <View className="flex-row flex-wrap gap-2">
              {card.skills_needed.map((key) => (
                <Tag key={key} label={tagLabel('skill', key, locale)} />
              ))}
            </View>
          </View>
        ) : null}

        {/* Consensus */}
        <VoteBar percent={consensus} locale={locale} />
        <Text className="text-[12px] text-muted-foreground">{t('fund.vote.equal', locale)}</Text>

        {/* Action. `votingClosed` is the state this screen claimed to render and could not until
            #382 gave it the edition: a quiet hairline chip, the same shape CandidateCard uses,
            never a disabled cyan CTA — nothing happened, so nothing glows (rule #4). */}
        <View className="gap-2">
          <View className="flex-row items-center justify-start">
            {voteState === 'votingClosed' ? (
              <View className="rounded-full border border-hair px-5 py-3">
                <Text className="text-[14px] text-muted-foreground">
                  {t('fund.vote.closed', locale)}
                </Text>
              </View>
            ) : voteState === 'voting' ? (
              <View className="h-[44px] items-center justify-center px-5">
                <ActivityIndicator color={semantic.aura} />
              </View>
            ) : voteState === 'voted' ? (
              <View className="rounded-full border border-hair px-5 py-3">
                <Text className="text-[14px] text-foreground">{t('fund.vote.done', locale)}</Text>
              </View>
            ) : (
              <Pressable
                className="rounded-full bg-aura px-6 py-3"
                onPress={onVote}
                accessibilityRole="button"
                accessibilityLabel={t('fund.vote.cta', locale)}
              >
                <Text className="text-[14px] font-semibold tracking-wide text-on-aura">
                  {t('fund.vote.cta', locale)}
                </Text>
              </Pressable>
            )}
          </View>

          {/* The refused vote, said out loud (#382). Same token as the contribution failure on
              fund-disclosure.tsx — a refusal is not a passive hint. */}
          {voteErrorKey ? (
            <Text className="text-[12px] leading-4 text-error">{t(voteErrorKey, locale)}</Text>
          ) : null}
        </View>
      </ScrollView>
    </FundChrome>
  );
}

/** Shared modal chrome — back chevron + fund title, on the Screen inset root. */
function FundChrome({ children, locale }: { children: React.ReactNode; locale: 'it' | 'en' }) {
  return (
    <Screen>
      <ModalHeader title={t('fund.title', locale)} backLabel={t('common.back', locale)} />
      {children}
    </Screen>
  );
}

/**
 * Player child so `useVideoPlayer` never sits behind the URL conditional (hooks
 * rules) — a fresh instance per `uri`. Muted autoplay loop, like Lightbox.
 */
function DetailVideo({ uri, onError }: { uri: string; onError: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  // A dead URL flips the frame to unavailable (#278) instead of a player that never plays.
  useVideoFailure(player, onError);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />;
}
