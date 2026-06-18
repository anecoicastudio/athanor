import { ActivityIndicator } from 'react-native';
import type { CandidateCard as CandidateCardModel } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { auraGlow } from '@/lib/glow';
import { VoteBar } from './VoteBar';

export type VoteState = 'notVoted' | 'voting' | 'voted' | 'votingClosed' | 'winner';

/**
 * One candidate in the «Sogni candidati» list (M7 §3.2). A calm dark card:
 * a 16:9 video-thumb tile (poster frame deferred → centered ▶ glyph, like a
 * null `thumb_path`), the dream title, a muted author line, the consensus
 * <VoteBar>, and a right-side action driven by `voteState`.
 *
 * Glow discipline (rule #4): the ONLY glow here is the `winner` ribbon «Sogno
 * scelto ✦» — a moment happened. «Vota» is FLAT aura cyan; «Votato ✦» /
 * «Voto chiuso» are quiet. No vanity counts beyond the sanctioned consensus %
 * (rule #3) — tapping the body opens the detail with the real player.
 */
export function CandidateCard({
  card,
  consensus,
  voteState,
  locale,
  onVote,
  onOpen,
}: {
  card: CandidateCardModel;
  consensus: number;
  voteState: VoteState;
  locale: Locale;
  onVote: () => void;
  onOpen: () => void;
}) {
  const title = card.title ?? card.category ?? '';

  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-3">
      {/* Video-thumb tile — tap → detail (real player) */}
      <Pressable
        className="aspect-video w-full items-center justify-center overflow-hidden rounded-card bg-raise-2"
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('fund.candidate.playLabel', locale)}
      >
        <Text className="text-4xl text-foreground">▶</Text>
      </Pressable>

      {/* Title + author */}
      <Pressable onPress={onOpen} accessibilityRole="button">
        <Text className="text-[15px] leading-5 text-foreground" numberOfLines={2}>
          {title}
        </Text>
        <Text className="mt-1 text-[12px] text-muted-foreground">
          {t('fund.vote.author', locale, {
            name: card.handle ?? '—',
            city: card.city ?? '',
            category: card.category ?? '',
          })}
        </Text>
      </Pressable>

      {/* Consensus bar */}
      <VoteBar percent={consensus} locale={locale} />

      {/* Action by vote-state */}
      <View className="flex-row items-center justify-end">
        {voteState === 'winner' ? (
          <View
            className="rounded-full border border-aura-line bg-aura-soft px-4 py-2"
            style={auraGlow(1)}
          >
            <Text className="text-[13px] font-semibold text-aura">
              {t('fund.vote.winner', locale)}
            </Text>
          </View>
        ) : voteState === 'votingClosed' ? (
          <View className="rounded-full border border-hair px-4 py-2">
            <Text className="text-[13px] text-muted-foreground">
              {t('fund.vote.closed', locale)}
            </Text>
          </View>
        ) : voteState === 'voted' ? (
          <View className="rounded-full border border-hair px-4 py-2">
            <Text className="text-[13px] text-foreground">{t('fund.vote.done', locale)}</Text>
          </View>
        ) : voteState === 'voting' ? (
          <View className="h-[36px] items-center justify-center px-4">
            <ActivityIndicator color={semantic.aura} />
          </View>
        ) : (
          <Pressable
            className="rounded-full bg-aura px-5 py-2"
            onPress={onVote}
            accessibilityRole="button"
            accessibilityLabel={t('fund.vote.cta', locale)}
          >
            <Text className="text-[13px] font-semibold tracking-wide text-on-aura">
              {t('fund.vote.cta', locale)}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
