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
import { momentiDeckView } from '@/lib/momenti-deck-state';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/hooks/use-locale';
import { useMomentiAnswered } from '@/hooks/use-momenti-answered';
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
  // One transient pill for both swipe outcomes (#633): accept carries the reciprocity
  // model, pass finally says what happened at all — «Momento passato» existed in both
  // catalogs since the deck shipped and was rendered nowhere, so a member who spent one
  // of three daily proposals got absolute silence. The timer lives in a ref so unmount
  // clears it (it used to leak).
  const [deckToast, setDeckToast] = useState<string | null>(null);
  const deckToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashDeckToast = (msg: string) => {
    setDeckToast(msg);
    if (deckToastTimer.current) clearTimeout(deckToastTimer.current);
    deckToastTimer.current = setTimeout(() => setDeckToast(null), 1900);
  };
  useEffect(
    () => () => {
      if (deckToastTimer.current) clearTimeout(deckToastTimer.current);
    },
    [],
  );
  const [done, setDone] = useState(false);

  const deck = useMomentiDeck();
  const cards = deck.data ?? [];
  // The persisted «has ever answered a Momento» fact. `done` cannot carry it: it is component
  // state, so a remount (cold start, dev reload, re-auth) resets it while the persisted query
  // cache rehydrates the empty deck as a settled success — and the empty state offered the
  // never-had-one promise to a member who swiped through yesterday (#600). A tab switch is not
  // that case: bottom-tabs keeps a visited tab mounted, so `done` survives navigation.
  const answered = useMomentiAnswered();

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

  // Both swipes flip a proposal out of `pending`, so both change the deck AND the answered
  // fact. Invalidating only the deck left `answered` on the `false` cached at mount for
  // `staleTime` (30s), which is long enough to render the never-had-one promise to a member
  // who has just swiped through — #600 reintroduced inside the very session that fixed it.
  const invalidateMomenti = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: momentiKeys.deck() }),
      qc.invalidateQueries({ queryKey: momentiKeys.answered() }),
    ]);

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
        flashDeckToast(t('momenti.toast.sentAccept', locale, { name: card.handle ?? '' }));
      }
      void invalidateMomenti();
    },
  });

  const pass = useMutation({
    mutationFn: (card: MomentoDeckCard) => passMoment(supabase, card.id),
    onSuccess: () => {
      // The silent branch (#633): a pass spends one of three daily proposals and parks a
      // person for 90 days — it deserves at least the sentence someone already wrote.
      flashDeckToast(t('momenti.toast.passed', locale));
      void invalidateMomenti();
    },
  });

  // Every claim this screen makes about the deck comes from one derivation, tested in
  // `lib/momenti-deck-state.ts`: which arm renders, whether the cyan eyebrow may say «Hai un
  // Momento», and which of the two empty sentences is true (#594).
  const { hasMomento, exhausted, neverHadOne } = momentiDeckView({
    isLoading: deck.isLoading,
    isError: deck.isError,
    isSuccess: deck.isSuccess,
    cardCount: cards.length,
    sweptThrough: done,
    everAnswered: answered.data,
  });
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

        {/* #633: the consequences, BEFORE the gesture. The deck's pattern promises
            cheap-and-infinite; the database says one-sided send and a 90-day park
            (momento_proposals.passed_until) — until these two lines, that number
            existed only in SQL and the reciprocity model only in a 1.9s toast on
            one of the two branches. Caption register, muted: information, not alarm. */}
        {hasMomento ? (
          <View className="mt-3 gap-0.5">
            <Text className="text-center text-[12px] leading-4 text-faint">
              {t('momenti.hint.accept', locale, { name: topHandle })}
            </Text>
            <Text className="text-center text-[12px] leading-4 text-faint">
              {t('momenti.hint.pass', locale)}
            </Text>
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
        {deckToast !== null ? (
          <View
            pointerEvents="none"
            className="absolute inset-x-5 bottom-6 items-center"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <View className="rounded-full border border-hair bg-raise-2 px-5 py-2.5">
              <Text className="text-center text-[14px] font-semibold text-foreground">
                {deckToast}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
