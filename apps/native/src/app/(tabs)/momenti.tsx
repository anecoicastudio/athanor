import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { acceptMoment, getMomentiSuggestions, momentiKeys, passMoment } from '@athanor/api';
import type { MomentoDeckCard } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import { SwipeDeck, type SwipeDeckHandle } from '@/components/momenti/SwipeDeck';
import { SuggestionRow } from '@/components/momenti/SuggestionRow';
import { useAnnounceOnMount } from '@/lib/a11y';
import { momentiDeckView } from '@/lib/momenti-deck-state';
import { deckWellHeight } from '@/lib/type-scale';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/hooks/use-locale';
import { useMomentiAnswered } from '@/hooks/use-momenti-answered';
import { useMomentiDeck } from '@/hooks/use-momenti-deck';

/** The screen's block gap (`gap-[26px]`) — the one gap under the well `deckWellHeight` must leave. */
const ACTION_GAP = 26;
/** `Button`'s `min-h-[50px]`: the action row's height until it has been measured. */
const ACTION_ROW_FALLBACK = 50;

/**
 * The Momenti tab (frontend §1/§2): few, curated proposals on a swipe deck.
 * Accept on a one-sided like → «Momento inviato» toast; a mutual match fires the
 * match overlay ((modal)/match, built in the sibling slice task). No vanity counts.
 * Aura is never written here (#1).
 *
 * Galleria since 2026-10-05 (#921; DESIGN §8.4): blocks 26 apart on a 20 gutter. The one
 * bordered card is the staging Momento (`MomentoCard`); the one cyan is the 8px dot beside
 * «Hai un Momento», the waiting-Momento mark (DESIGN §2.3). «Passa» is the outline pill and
 * «Connetti ✦» the white one, in a `ButtonRow`, so at the largest text sizes they wrap one
 * above the other instead of breaking a word. The suggestions are one group of rows.
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
  // The iOS half of the pill below (#635). It carries `accessibilityLiveRegion`, which is
  // Android-only, and it deliberately bypasses `ToastHost` — which is where the imperative
  // announcement lives — so on the platform testers actually hold, accepting a Momento produced
  // no announcement at all.
  useAnnounceOnMount(deckToast ?? undefined);
  const [sweptKey, setSweptKey] = useState<string | null>(null);

  const deck = useMomentiDeck();
  const cards = deck.data ?? [];
  // The persisted «has ever answered a Momento» fact. `done` cannot carry it: it is component
  // state, so a remount (cold start, dev reload, re-auth) resets it while the persisted query
  // cache rehydrates the empty deck as a settled success — and the empty state offered the
  // never-had-one promise to a member who swiped through yesterday (#600). A tab switch is not
  // that case: bottom-tabs keeps a visited tab mounted, so `done` survives navigation.
  const answered = useMomentiAnswered();

  // The in-session swipe-through latch (SwipeDeck.onEmpty fires once its local index passes
  // the array), carrying the deck it swept. Two things must hold, and only one of them is
  // about the key:
  //
  // - it stays true through the window where the mutation and the refetch have not settled —
  //   `cards` is still the answered array there, so the key still matches;
  // - it stays true when the refetch comes back EMPTY, which is the ordinary end of a
  //   swipe-through. `neverHadOne` is `deckIsEmpty && !sweptThrough && everAnswered === false`,
  //   so dropping the latch on an empty deck offers «Quando troviamo la persona giusta» to
  //   someone who just answered every card — the #600 defect this latch exists to prevent.
  //
  // It goes false only when a refetch brings a DIFFERENT, NON-EMPTY deck back, or the tab
  // strands. Both conditions are readable during render, so no effect clears a flag a commit
  // later (#691).
  const deckKey = cards.map((c) => c.id).join('|');
  const done = sweptKey !== null && (cards.length === 0 || sweptKey === deckKey);

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
  // `lib/momenti-deck-state.ts`: which arm renders, whether the label may say «Hai un
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
  // The deck well has a height of its own because `SwipeDeck` lays an `absolute inset-0` peek
  // card under the top card and the loading and empty arms have no size to give it. A hard
  // `h-[438px]` clipped the card's dream quote at AX sizes with nothing to scroll (#639), so
  // the well scales with the member's text size, bounded by the same 2x the text cap uses —
  // this screen is inside a ScrollView, so a taller well simply scrolls.
  //
  // Since 2026-10-05 that height is a MINIMUM (Marco, #921): the top card is in flow and
  // grows the well when its text needs more. Measured that day on the iPhone SE simulator at
  // AX5, a card with three reasons and a three-line dream needed 826pt of a 760pt well once
  // the reasons were body text, and its last line was cut; with the minimum it is whole and
  // the pills stand 66pt lower. At the default size the same card needs 364 of 398.
  const { fontScale } = useWindowDimensions();
  // …and 438 is a MAXIMUM (#751): on an iPhone SE a 438pt well pushed Passa / Connetti under
  // the tab bar. The room is measured, not derived from insets — the ScrollView's own height
  // already excludes the tab bar, `Screen`'s safe-area edges and its suspension banner, and
  // the well's `y` already includes the header and the eyebrow.
  const [viewport, setViewport] = useState<number | undefined>(undefined);
  const [wellTop, setWellTop] = useState(0);
  const [actionRow, setActionRow] = useState(ACTION_ROW_FALLBACK);
  const wellHeight = deckWellHeight({
    viewport,
    wellTop,
    actionGap: ACTION_GAP,
    actionRow,
    fontScale,
  });

  return (
    <Screen>
      {/* No `fontScale` key here any more (#833 → #754): a live text-size change remounts
          every src/tw Text instead, which re-lays out the boxes above it and so re-fires the
          `onLayout` inputs of `deckWellHeight` whose layout moved (`fontScale` itself is read
          above). A key here would also reset the scroll and remount the whole deck. */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-[26px] px-5 pb-12 pt-4"
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
      >
        <View className="gap-1">
          {/* The dot is the waiting-Momento mark, one of the five places cyan stands (DESIGN
              §2.3). It is drawn only once the deck is known to hold a card: while the read is
              out `hasMomento` is false and the line is absent, which claims nothing. */}
          {hasMomento ? (
            <View className="flex-row items-center gap-2">
              <View className="h-2 w-2 rounded-full bg-aura" />
              <SectionLabel>{t('momenti.eyebrow', locale)}</SectionLabel>
            </View>
          ) : null}
          {/* h1 32/600 — the tab-root header recipe (DESIGN §6 → Screen headers). */}
          <Text accessibilityRole="header" className="type-h1 text-foreground">
            {t('momenti.title', locale)}
          </Text>
          <Text className="type-small text-muted-foreground">{t('momenti.sub', locale)}</Text>
        </View>

        <View
          style={{ minHeight: wellHeight }}
          onLayout={(e) => setWellTop(e.nativeEvent.layout.y)}
        >
          {deck.isLoading ? (
            <View className="grow rounded-[28px] border border-hair bg-surface opacity-60" />
          ) : deck.isError ? (
            // `momenti.error`, not `momenti.empty.title` — the error branch used to borrow the
            // empty state's sentence, so a failed deck read said «Nessun Momento per ora» over a
            // retry button that contradicted it (#111).
            <ListState
              state="error"
              locale={locale}
              errorLabel={t('momenti.error', locale)}
              onRetry={() => void deck.refetch()}
              className="grow justify-center px-5"
            />
          ) : exhausted ? (
            <View className="grow items-center justify-center">
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
              onEmpty={() => setSweptKey(deckKey)}
            />
          )}
        </View>

        {hasMomento ? (
          <View onLayout={(e) => setActionRow(e.nativeEvent.layout.height)}>
            <ButtonRow>
              <Button
                variant="outline"
                label={t('momenti.pass', locale)}
                accessibilityLabel={t('momenti.a11y.pass', locale, { name: topHandle })}
                onPress={() => deckRef.current?.swipe('left')}
              />
              <Button
                label={t('momenti.connect', locale)}
                accessibilityLabel={t('momenti.a11y.accept', locale, { name: topHandle })}
                onPress={() => deckRef.current?.swipe('right')}
              />
            </ButtonRow>
          </View>
        ) : null}

        {/* #633: the consequences, BEFORE the gesture. The deck's pattern promises
            cheap-and-infinite; the database says one-sided send and a 90-day park
            (momento_proposals.passed_until) — until these two lines, that number
            existed only in SQL and the reciprocity model only in a 1.9s toast on
            one of the two branches. Small and grey: information, not alarm. The prototype
            draws the first line only; the second is #633's and stays. */}
        {hasMomento ? (
          <View className="gap-1">
            <Text className="type-small text-muted-foreground">
              {t('momenti.hint.accept', locale, { name: topHandle })}
            </Text>
            <Text className="type-small text-muted-foreground">
              {t('momenti.hint.pass', locale)}
            </Text>
          </View>
        ) : null}

        {/* «una piccola lista curata, aggiornata ogni giorno» (PRD §4.7) — at most three, the
            server's rank order kept as it arrived. One group of rows under its label, 8 apart
            (the prototype's title group; `RowGroup`'s own `label` stands 12 away). */}
        {suggestions.data && suggestions.data.length > 0 ? (
          <View className="gap-2">
            <SectionLabel>{t('momenti.suggestionsTitle', locale)}</SectionLabel>
            <RowGroup>
              {suggestions.data.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.candidateId}
                  suggestion={suggestion}
                  locale={locale}
                />
              ))}
            </RowGroup>
          </View>
        ) : null}
      </ScrollView>
      {/* One-sided-accept toast: «Momento inviato ✦ …» — NOT the MomentFlash help string.
          A sibling of the ScrollView since 2026-10-05, so it stands over the foot of the screen:
          inside the scroll content `bottom-6` was the foot of the CONTENT, below the fold
          whenever the suggestions made the screen scroll (seen that day on the iPhone SE
          simulator: a pass showed no toast). */}
      {deckToast !== null ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-5 bottom-6 items-center"
          // Android reads this; iOS reads nothing from it — `accessibilityLiveRegion` is
          // Android-only, and this pill bypasses ToastHost (which announces imperatively). The
          // `useAnnounceOnMount` above is the iOS half (#635).
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {/* `Toast`'s shape (charcoal, hairline, 28), written here because this one stays
              out of `ToastHost`. */}
          <View className="rounded-[28px] border border-hair bg-surface px-5 py-3">
            <Text className="text-center type-small text-foreground">{deckToast}</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
