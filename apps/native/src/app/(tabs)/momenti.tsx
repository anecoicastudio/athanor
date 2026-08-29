import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { acceptMoment, getMomentiSuggestions, momentiKeys, passMoment } from '@athanor/api';
import type { MomentoDeckCard } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { SectionLabel } from '@/components/SectionLabel';
import { SwipeDeck, type SwipeDeckHandle } from '@/components/momenti/SwipeDeck';
import { SwipeActionButton } from '@/components/momenti/SwipeActionButton';
import { SuggestionRow } from '@/components/momenti/SuggestionRow';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/hooks/use-locale';
import { useMomentiDeck } from '@/hooks/use-momenti-deck';

/**
 * The Momenti tab (frontend §1/§2): few, curated proposals on a swipe deck.
 * Accept on a one-sided like → «Momento inviato» toast; a mutual match fires the
 * match overlay ((modal)/match, built in the sibling slice task). No vanity counts;
 * the glow is reserved for a real match (#4). Aura is never written here (#1).
 */
export default function MomentiScreen() {
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const deckRef = useRef<SwipeDeckHandle | null>(null);
  // The accept toast carries the candidate handle so it reads «Momento inviato ✦ … {name}».
  const [acceptToast, setAcceptToast] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const deck = useMomentiDeck();
  const cards = deck.data ?? [];
  const deckIsEmpty = deck.isSuccess && cards.length === 0;

  // `done` latches the in-session swipe-through (SwipeDeck.onEmpty fires once its
  // local index passes the array). A refetch that brings fresh cards back must
  // un-strand the deck — otherwise the exhausted state would stick forever.
  useEffect(() => {
    if (cards.length > 0) setDone(false);
  }, [cards.length]);

  const suggestions = useQuery({
    queryKey: momentiKeys.suggestions(),
    queryFn: () =>
      getMomentiSuggestions(
        supabase,
        cards.map((c) => c.candidateId),
      ),
    enabled: deck.isSuccess,
  });

  const accept = useMutation({
    mutationFn: (card: MomentoDeckCard) => acceptMoment(supabase, card.id),
    onSuccess: (res, card) => {
      if (res.matched) {
        router.push({
          pathname: '/(modal)/match',
          params: {
            name: card.handle ?? '',
            source: 'accepted',
            conversationId: res.conversationId ?? '',
          },
        });
      } else {
        setAcceptToast(card.handle ?? '');
        setTimeout(() => setAcceptToast(null), 1900);
      }
      void qc.invalidateQueries({ queryKey: momentiKeys.deck() });
    },
  });

  const pass = useMutation({
    mutationFn: (card: MomentoDeckCard) => passMoment(supabase, card.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: momentiKeys.deck() }),
  });

  const exhausted = deckIsEmpty || done;
  // «Hai un Momento» is a claim about the deck, so it renders only when a card is actually on
  // the stack — the gate the swipe buttons already used, now shared so the two cannot drift
  // apart again. The eyebrow used to sit above the whole four-way branch, telling a member whose
  // read is still in flight, whose read failed, or who has no Momento at all that they have one,
  // in the cyan rule #4 spends on meaning (#594). Home gates the same string the same way:
  // `MomentiCard` collapses the block when there is no top card.
  const hasMomento = !exhausted && !deck.isLoading && !deck.isError && cards.length > 0;
  // `done` is the only trustworthy «this member HAD a Momento» signal. `deckIsEmpty` is a
  // property of the current read, and both mutations invalidate the deck, so swiping through
  // makes the refetch return [] — which would otherwise serve «Quando troviamo la persona
  // giusta» (the never-had-one copy) to someone who has just consumed their whole deck.
  const neverHadOne = deckIsEmpty && !done;
  const topHandle = cards[0]?.handle ?? '';

  return (
    <Screen>
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-12">
        {hasMomento ? (
          <SectionLabel tone="aura">{t('momenti.eyebrow', locale)}</SectionLabel>
        ) : null}
        {/* h1 24/600 — the one in-content tab header recipe (DESIGN §6 → Screen headers). */}
        <Text accessibilityRole="header" className="text-2xl font-semibold text-foreground">
          {t('momenti.title', locale)}
        </Text>
        <Text className="mt-1 text-[14px] text-faint">{t('momenti.sub', locale)}</Text>

        <View className="mt-5 h-[438px]">
          {deck.isLoading ? (
            <View className="flex-1 rounded-card border border-hair bg-raise opacity-60" />
          ) : deck.isError ? (
            // `momenti.error`, not `momenti.empty.title` — the error branch used to borrow the
            // empty state's sentence, so a failed deck read said «Nessun Momento per ora» over a
            // retry button that contradicted it (#111).
            <ListState
              state="error"
              locale={locale}
              errorLabel={t('momenti.error', locale)}
              onRetry={() => void deck.refetch()}
              className="flex-1 justify-center px-5"
            />
          ) : exhausted ? (
            <View className="flex-1 items-center justify-center">
              <EmptyState
                body={
                  neverHadOne ? t('momenti.none.body', locale) : t('momenti.empty.body', locale)
                }
              >
                {t('momenti.empty.title', locale)}
              </EmptyState>
            </View>
          ) : (
            <SwipeDeck
              cards={cards}
              locale={locale}
              deckRef={deckRef}
              onAccept={(c) => accept.mutate(c)}
              onPass={(c) => pass.mutate(c)}
              onEmpty={() => setDone(true)}
            />
          )}
        </View>

        {hasMomento ? (
          <View className="mt-5 flex-row gap-4">
            <SwipeActionButton
              variant="pass"
              label={t('momenti.pass', locale)}
              a11yLabel={t('momenti.a11y.pass', locale, { name: topHandle })}
              onPress={() => deckRef.current?.swipe('left')}
            />
            <SwipeActionButton
              variant="connect"
              label={t('momenti.connect', locale)}
              a11yLabel={t('momenti.a11y.accept', locale, { name: topHandle })}
              onPress={() => deckRef.current?.swipe('right')}
            />
          </View>
        ) : null}

        {/* «una piccola lista curata, aggiornata ogni giorno» (PRD §4.7) — at most three, the
            server's rank order kept as it arrived. No glow: a suggestion is not a moment (#4). */}
        {suggestions.data && suggestions.data.length > 0 ? (
          <View className="mt-8">
            {/* mb-3 + gap-3, matching DreamSection's IncomingOfferRow list — the app's only
                other stack of Avatar + flex-1 + Tag rows, where label and rows share one rhythm. */}
            <SectionLabel className="mb-3">{t('momenti.suggestionsTitle', locale)}</SectionLabel>
            <View className="gap-3">
              {suggestions.data.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.candidateId}
                  suggestion={suggestion}
                  locale={locale}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* One-sided-accept toast: «Momento inviato ✦ …» — NOT the MomentFlash help string. */}
        {acceptToast !== null ? (
          <View
            pointerEvents="none"
            className="absolute inset-x-5 bottom-6 items-center"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <View className="rounded-full border border-hair bg-raise-2 px-5 py-2.5">
              <Text className="text-center text-[14px] font-semibold text-foreground">
                {t('momenti.toast.sentAccept', locale, { name: acceptToast })}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
