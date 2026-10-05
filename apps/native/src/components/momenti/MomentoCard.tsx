import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale, MomentoDeckCard } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { PRESS_DIM } from '@/lib/press';
import { AffinityRow } from './AffinityRow';

/**
 * Per-proposal deck card (frontend §9): avatar + handle + a read-only «✦ Aura» line in grey
 * (rule #1 — Aura is never client-rendered as a real number here; the line carries
 * no digit at all, so it cannot be read as a score of zero), the affinity reasons the
 * API already ranked and capped (`rankReasons`, #384 — this card does not re-decide
 * which ones fit), and the peer's dream quote in the Hanken-italic dream register (the same
 * `type-quote` treatment as DreamCard, never a UI font).
 *
 * This is the Momenti tab's one bordered card (#921, 2026-10-05; DESIGN §6, §8.4): the
 * prototype's `.card`, a hairline on charcoal, radius 28, 20 inside, 14 between its three
 * parts, a 72 disc. It writes that shape itself instead of rendering the shared `Card`, which
 * takes no `grow`, and this card fills the deck well (and makes it taller when its text needs
 * more than the well's minimum).
 *
 * The quote is clamped to DREAM_QUOTE_LINES (#833): a dream runs to 500 characters and the
 * deck well was a fixed height then, so an unclamped quote ran out of the card and under the
 * «Passa» / «Connetti» row. The clamp stays now that the card can grow the well (2026-10-05):
 * three lines is what keeps both pills on the first screen at the default size. The whole dream is one tap away on the peer's profile, where
 * DreamCard renders it unclamped — the deck card carries no dream id, so the profile is the
 * reachable home for it, not `dream/[id]`.
 */
const DREAM_QUOTE_LINES = 3;

export function MomentoCard({ card, locale }: { card: MomentoDeckCard; locale: Locale }) {
  const name = memberLabel(card.displayName, card.handle) ?? '—';
  const router = useRouter();
  return (
    // `bg-surface` is opaque, which the deck needs: it stacks the next card behind this one
    // (SwipeDeck), and a see-through fill let the peek card bleed through the text.
    // `overflow-hidden`: whatever the card holds stays inside its own border, never over the
    // «Passa» / «Connetti» row below the well (#833).
    <View className="grow gap-[14px] overflow-hidden rounded-[28px] border border-hair bg-surface p-5">
      <View className="flex-row items-center gap-[14px]">
        <Avatar
          decorative
          handle={card.handle}
          displayName={card.displayName}
          avatarPath={card.avatarPath}
          size={72}
        />
        <View className="flex-1 gap-0.5">
          <Text className="type-h2 text-foreground">{name}</Text>
          <Text className="type-small text-muted-foreground">{t('momenti.aura.chip', locale)}</Text>
        </View>
      </View>

      <View className="gap-1">
        {/* No slice: `rowToDeckCard` already ranked and capped these at
            MOMENTO_DECK_REASON_LIMIT (#384). Slicing here as well made this component a
            second, silent copy of the display policy — and since it cut the END of the
            array, it cut exactly the two hardest-earned terms. */}
        {card.reasons.map((reason) => (
          <AffinityRow key={reason.kind} reason={reason} locale={locale} />
        ))}
      </View>

      {card.dreamText ? (
        <View className="gap-2">
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
            className={cn('min-h-[44px]', PRESS_DIM)}
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
  );
}
