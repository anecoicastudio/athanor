import { useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  candidacyKeys,
  castVote,
  getCandidateById,
  getEditionTally,
  getMyVote,
  signMediaUrls,
  voteKeys,
} from '@athanor/api';
import { consensusForCandidacy } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { VoteState } from '@/components/fund/CandidateCard';
import { VoteBar } from '@/components/fund/VoteBar';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Candidate detail (M7 §3.4). Honest MVP: a signed-URL video player + title +
 * author line + the consensus <VoteBar> + the same Vota/Votato/Voto-chiuso
 * action & mutation as the card. Fetches via `getCandidateById` so deep links
 * work. Reduced-motion safe — no entrance animation here; the player only
 * autoplays muted on a loop.
 *
 * DEFERRED: story / goal / impact — the `fund_candidate_cards` view doesn't
 * carry them, so showing them would need a second query against
 * `dream_candidacies`; left out of this slice (see task report).
 */
export default function CandidacyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
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

  // Refetch the tally on focus — others' votes don't stream (own-row RLS).
  useFocusEffect(
    useCallback(() => {
      if (editionId) {
        qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
      }
    }, [editionId, qc]),
  );

  const vote = useMutation({
    mutationFn: () => castVote(supabase, { editionId, candidacyId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: voteKeys.mine(editionId) });
      qc.invalidateQueries({ queryKey: voteKeys.tally(editionId) });
    },
    // On error the mutation resets `isPending` → the action falls back to «Vota»
    // (no toast host; the state is the feedback).
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

  // ── Loading / not-found ───────────────────────────────────────────────────
  if (cardQuery.isLoading) {
    return (
      <Screen onBack={() => router.back()} locale={locale}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={semantic.aura} />
        </View>
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen onBack={() => router.back()} locale={locale}>
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-center text-[15px] text-muted-foreground">
            {t('fund.candidates.empty', locale)}
          </Text>
        </View>
      </Screen>
    );
  }

  const consensus = consensusForCandidacy(tally, card.candidacy_id);
  const voteState: VoteState = vote.isPending
    ? 'voting'
    : myVote?.candidacy_id === card.candidacy_id
      ? 'voted'
      : 'notVoted';
  const title = card.title ?? card.category ?? '';

  return (
    <Screen onBack={() => router.back()} locale={locale}>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-16">
        {/* Player */}
        <View className="aspect-video w-full items-center justify-center overflow-hidden rounded-card bg-raise-2">
          {videoUrl ? (
            <DetailVideo uri={videoUrl} />
          ) : (
            <Text className="text-4xl text-foreground">▶</Text>
          )}
        </View>

        {/* Title + author */}
        <View className="gap-1">
          <Text className="text-xl leading-7 text-foreground">{title}</Text>
          <Text className="text-[13px] text-muted-foreground">
            {t('fund.vote.author', locale, {
              name: card.handle ?? '—',
              city: card.city ?? '',
              category: card.category ?? '',
            })}
          </Text>
        </View>

        {/* Consensus */}
        <VoteBar percent={consensus} locale={locale} />
        <Text className="text-[12px] text-muted-foreground">{t('fund.vote.weighted', locale)}</Text>

        {/* Action */}
        <View className="flex-row items-center justify-start">
          {voteState === 'voting' ? (
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
      </ScrollView>
    </Screen>
  );
}

/** Shared modal chrome — back chevron + fund title. */
function Screen({
  children,
  onBack,
  locale,
}: {
  children: React.ReactNode;
  onBack: () => void;
  locale: 'it' | 'en';
}) {
  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel={t('common.back', locale)}>
          <Text className="text-[22px] text-foreground">‹</Text>
        </Pressable>
        <Text className="text-2xl text-foreground">{t('fund.title', locale)}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * Player child so `useVideoPlayer` never sits behind the URL conditional (hooks
 * rules) — a fresh instance per `uri`. Muted autoplay loop, like Lightbox.
 */
function DetailVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />;
}
