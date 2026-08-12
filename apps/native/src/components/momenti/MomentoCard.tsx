import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale, MomentoDeckCard } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { AffinityRow } from './AffinityRow';

/**
 * Per-proposal deck card (frontend §9): avatar + handle + read-only «✦ Aura 0» chip
 * (rule #1 — Aura is never client-rendered as a real number here), up to 3 affinity
 * reasons, and the peer's dream quote in the Hanken-italic dream register (the same
 * `font-dream` quote treatment as DreamCard, never a UI font).
 */
export function MomentoCard({ card, locale }: { card: MomentoDeckCard; locale: Locale }) {
  const name = memberLabel(card.displayName, card.handle) ?? '—';
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
            <Text className="text-[12px] text-faint">✦ Aura 0</Text>
          </View>
        </View>

        <View className="mt-4 gap-1">
          {card.reasons.slice(0, 3).map((reason, i) => (
            <AffinityRow key={i} reason={reason} locale={locale} />
          ))}
        </View>

        {card.dreamText ? (
          <View className="mt-4">
            <SectionLabel>{t('momenti.theirDream', locale)}</SectionLabel>
            <DreamQuote text={card.dreamText} className="mt-1" />
          </View>
        ) : null}
      </View>
    </View>
  );
}
