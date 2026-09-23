import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale, MomentoDeckCard } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { AffinityRow } from './AffinityRow';

/**
 * Per-proposal deck card (frontend §9): avatar + handle + read-only «✦ Aura» chip
 * (rule #1 — Aura is never client-rendered as a real number here; the chip carries
 * no digit at all, so it cannot be read as a score of zero), the affinity reasons the
 * API already ranked and capped (`rankReasons`, #384 — this card does not re-decide
 * which ones fit), and the peer's dream quote in the Hanken-italic dream register (the same
 * `font-dream` quote treatment as DreamCard, never a UI font).
 *
 * The quote is clamped to DREAM_QUOTE_LINES (#833): a dream runs to 500 characters and the
 * deck well is a fixed height, so an unclamped quote ran out of the card and under the
 * «Passa» / «Connetti» row. The whole dream is one tap away on the peer's profile, where
 * DreamCard renders it unclamped — the deck card carries no dream id, so the profile is the
 * reachable home for it, not `dream/[id]`.
 */
const DREAM_QUOTE_LINES = 3;

export function MomentoCard({ card, locale }: { card: MomentoDeckCard; locale: Locale }) {
  const name = memberLabel(card.displayName, card.handle) ?? '—';
  const router = useRouter();
  return (
    // Opaque base (bg-background) UNDER the bg-raise tint: the deck stacks the next card behind
    // this one (SwipeDeck), and bg-raise alone (rgba ~4%) is see-through — the peek card bled
    // through and garbled the text. The base occludes it while preserving the raised-card look.
    <View className="flex-1 rounded-card bg-background">
      <View className="flex-1 rounded-card border border-aura-line bg-raise p-5">
        <View className="flex-row items-center gap-3">
          <Avatar
            handle={card.handle}
            displayName={card.displayName}
            avatarPath={card.avatarPath}
            size={56}
          />
          <View className="flex-1">
            <Text className="text-[18px] font-semibold text-foreground">{name}</Text>
            <Text className="text-[12px] text-faint">{t('momenti.aura.chip', locale)}</Text>
          </View>
        </View>

        <View className="mt-4 gap-1">
          {/* No slice: `rowToDeckCard` already ranked and capped these at
              MOMENTO_DECK_REASON_LIMIT (#384). Slicing here as well made this component a
              second, silent copy of the display policy — and since it cut the END of the
              array, it cut exactly the two hardest-earned terms. */}
          {card.reasons.map((reason) => (
            <AffinityRow key={reason.kind} reason={reason} locale={locale} />
          ))}
        </View>

        {card.dreamText ? (
          <View className="mt-4">
            <SectionLabel>{t('momenti.theirDream', locale)}</SectionLabel>
            {/*
              A tap, not a pan: this Pressable holds the responder only until the deck's
              PanResponder claims a horizontal move (`onMoveShouldSetPanResponder` bubbles up
              from here), so a drag that starts on the quote still swipes the card.

              Label = the WHOLE dream, hint = where the tap goes: `numberOfLines` truncates
              what is drawn, and the label is what keeps the full text spoken (DreamCard's
              pattern, #356). `min-h-[44px]` gives the target geometry of its own (§10) —
              a clamped quote is taller anyway, but a one-line dream is not.
            */}
            <Pressable
              className="mt-1 min-h-[44px]"
              accessibilityRole="button"
              accessibilityLabel={t('dream.a11y.theirQuote', locale, { dream: card.dreamText })}
              accessibilityHint={t('momenti.a11y.openProfile', locale)}
              onPress={() => router.push(`/(modal)/user/${card.candidateId}`)}
            >
              <DreamQuote text={card.dreamText} numberOfLines={DREAM_QUOTE_LINES} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
