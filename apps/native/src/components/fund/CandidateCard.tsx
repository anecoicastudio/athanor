import { ActivityIndicator } from 'react-native';
import type { CandidateCard as CandidateCardModel } from '@athanor/api';
import { semantic } from '@athanor/config';
import { formatFundTotal } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { authorParts, categoryLabel, confirmedHistory } from '@/lib/ballot-card';
import { auraGlow } from '@/lib/glow';
import { MediaFrame } from '@/components/media/MediaFrame';
import { VoteBar } from './VoteBar';

export type VoteState =
  | 'notVoted'
  | 'voteElsewhere'
  | 'voting'
  | 'voted'
  | 'votingClosed'
  | 'winner';

/**
 * One candidate in the «Sogni candidati» list (M7 §3.2). A calm dark card:
 * a 16:9 poster tile drawn from the candidacy's own video (`thumb_path`;
 * null → the faint ▶ of a genuinely poster-less application), the dream
 * title, a muted author line, the consensus <VoteBar>, and a right-side
 * action driven by `voteState`.
 *
 * Glow discipline (rule #4): the ONLY glow here is the `winner` ribbon «Sogno
 * scelto ✦» — a moment happened. «Vota» is FLAT aura cyan; «Votato ✦» /
 * «Voto chiuso» / «Sposta il voto» are quiet — moving a held vote is a
 * correction, not a moment. No vanity counts beyond the sanctioned consensus %
 * (rule #3) — tapping the body opens the detail with the real player.
 *
 * #227 adds the two things the vote is actually about: BOTH money figures (a
 * €3.000 dream the pool covers and an €80.000 one it does not are the same card
 * without them) and, where the author linked a personal dream, its CONFIRMED
 * history. Confirmed is the whole line — a completed milestone and a completed
 * help are evidence of action, an offered help is a promise, and a promise is a
 * number enthusiasm can inflate. `confirmedHistory` also collapses the block
 * when there is nothing confirmed yet, rather than printing «· 0» about a dream
 * planted last week.
 *
 * SKILLS ARE NOT HERE, deliberately. `skills_needed` holds up to ten keys, and a
 * wrapping chip cloud inside a list card is the crowding PR #376's reviewer
 * named when this data landed unsurfaced. DESIGN.md §9 gives a Card one padding
 * and one rhythm; ten chips break it and push the vote action below the fold on
 * every candidate. They render on the detail, where there is a scroll to spend.
 */
export function CandidateCard({
  card,
  posterUrl,
  isLoadingPoster,
  consensus,
  voteState,
  locale,
  onVote,
  onOpen,
}: {
  card: CandidateCardModel;
  /** Signed URL for `card.thumb_path`, from the screen's one `useSignedUrls` call. */
  posterUrl?: string;
  /** That signing query's `isLoading`. Thread it — see the tile body for why. */
  isLoadingPoster: boolean;
  consensus: number;
  voteState: VoteState;
  locale: Locale;
  onVote: () => void;
  onOpen: () => void;
}) {
  const title = card.title ?? card.category ?? '';
  const author = authorParts({
    handle: card.handle,
    city: card.city,
    categoryLabel: categoryLabel(card.category, locale),
  }).join(' · ');
  const history = confirmedHistory(card);

  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-3">
      {/* Video-thumb tile — tap → detail (real player) */}
      <Pressable
        className="aspect-video w-full items-center justify-center overflow-hidden rounded-card bg-raise-2"
        onPress={onOpen}
        accessibilityRole="button"
        // One composed label (#292): the Pressable is an accessibility element, so anything
        // `accessible` nested inside it may never be spoken — the no-poster sentence has to
        // ride the button's own label to reliably reach a screen reader.
        accessibilityLabel={
          card.thumb_path === null
            ? `${t('fund.candidate.playLabel', locale)}, ${t('media.noPoster.video', locale)}`
            : t('fund.candidate.playLabel', locale)
        }
      >
        {card.thumb_path === null ? (
          // A candidacy with no poster is a STATE, not a failure: the video plays fine in the
          // detail, it just has no still. `media.unavailable.video` would be a lie here, which
          // is why this branch stays hand-rolled instead of becoming a fourth MediaFrame state.
          <View className="absolute inset-0 items-center justify-center">
            <Text
              className="text-4xl text-faint"
              // Decorative: the no-poster sentence rides the Pressable's label above (#292).
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ▶
            </Text>
          </View>
        ) : (
          // Three states, not two. A `posterUrl ? <Image/> : ▶` ternary would render "still
          // signing" and "never coming" as the same pixel — issue #135, rebuilt on a new
          // surface — and would announce "video with no preview" about a poster that is 200ms
          // from appearing. `compact` is omitted deliberately: it is for tile-sized surfaces,
          // and this tile is full-width 16:9, so the sentence fits and should be read.
          <MediaFrame
            kind="video"
            url={posterUrl}
            isLoading={isLoadingPoster}
            locale={locale}
            className="absolute inset-0"
          />
        )}
      </Pressable>

      {/* Title + author */}
      <Pressable onPress={onOpen} accessibilityRole="button" className="min-h-[44px]">
        <Text className="text-[15px] leading-5 text-foreground" numberOfLines={2}>
          {title}
        </Text>
        <Text className="mt-1 text-[12px] text-muted-foreground">{author}</Text>
      </Pressable>

      {/* The two money figures (#227, FUND-09/D10-D11). Labels muted, numbers foreground —
          money is status, not a moment, so no cyan and no glow (DESIGN §11 2026-06-12, the
          same reasoning that keeps the Aura number off `aura`). The «ballot information,
          not a gate» framing that D11 requires lives on the detail, where there is room for
          a sentence; the card carries the numbers. */}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Text className="text-[12px] text-muted-foreground">
          {t('fund.candidate.budget', locale)}{' '}
          <Text className="text-foreground">{formatFundTotal(card.budget_cents, locale)}</Text>
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {t('fund.candidate.minViable', locale)}{' '}
          <Text className="text-foreground">{formatFundTotal(card.min_viable_cents, locale)}</Text>
        </Text>
      </View>

      {/* The linked dream's confirmed history — one quiet line on the card, the full block on
          the detail. Absent entirely when there is nothing confirmed (see confirmedHistory). */}
      {history ? (
        <Text className="text-[12px] text-muted-foreground">
          {t('fund.candidate.history.milestones', locale, { n: history.milestones })}
          {' · '}
          {t('fund.candidate.history.helps', locale, { n: history.helps })}
        </Text>
      ) : null}

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
        ) : voteState === 'voteElsewhere' ? (
          // #633: the member's one vote sits on ANOTHER candidacy. «Vota» here would promise
          // an additional vote the server refuses; this quiet outline pill names the real
          // action — moving the one they have — before the confirm dialog restates the rule.
          <Pressable
            className="min-h-[44px] justify-center rounded-full border border-hair px-4 py-2"
            onPress={onVote}
            accessibilityRole="button"
            accessibilityLabel={t('fund.vote.move', locale)}
          >
            <Text className="text-[13px] text-foreground">{t('fund.vote.move', locale)}</Text>
          </Pressable>
        ) : (
          <Pressable
            className="min-h-[44px] justify-center rounded-full bg-aura px-5 py-2"
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
