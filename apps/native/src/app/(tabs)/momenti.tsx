import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import {
  acceptMoment,
  getMomentiDeck,
  getMomentiSuggestion,
  momentiKeys,
  passMoment,
} from '@athanor/api';
import type { MomentoDeckCard } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { SectionLabel } from '@/components/SectionLabel';
import { SwipeDeck, type SwipeDeckHandle } from '@/components/momenti/SwipeDeck';
import { SwipeActionButton } from '@/components/momenti/SwipeActionButton';
import { SuggestionRow } from '@/components/momenti/SuggestionRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * The Momenti tab (frontend §1/§2): few, curated proposals on a swipe deck.
 * Accept on a one-sided like → «Momento inviato» toast; a mutual match fires the
 * match overlay ((modal)/match, built in the sibling slice task). No vanity counts;
 * the glow is reserved for a real match (#4). Aura is never written here (#1).
 */
export default function MomentiScreen() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();
  const qc = useQueryClient();
  const deckRef = useRef<SwipeDeckHandle | null>(null);
  // The accept toast carries the candidate handle so it reads «Momento inviato ✦ … {name}».
  const [acceptToast, setAcceptToast] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const deck = useQuery({ queryKey: momentiKeys.deck(), queryFn: () => getMomentiDeck(supabase) });
  const cards = deck.data ?? [];
  const startedEmpty = deck.isSuccess && cards.length === 0;

  // `done` latches the in-session swipe-through (SwipeDeck.onEmpty fires once its
  // local index passes the array). A refetch that brings fresh cards back must
  // un-strand the deck — otherwise the exhausted state would stick forever.
  useEffect(() => {
    if (cards.length > 0) setDone(false);
  }, [cards.length]);

  const suggestion = useQuery({
    queryKey: momentiKeys.suggestions(),
    queryFn: () =>
      getMomentiSuggestion(
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

  const exhausted = (deck.isSuccess && cards.length === 0) || done;
  const showActions = !exhausted && !deck.isLoading && !deck.isError && cards.length > 0;
  const topHandle = cards[0]?.handle ?? '';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pt-4 pb-10">
      <SectionLabel tone="aura">{t('momenti.eyebrow', locale)}</SectionLabel>
      <Text className="text-[24px] font-bold text-foreground">{t('momenti.title', locale)}</Text>
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
            <EmptyState>
              {`${t('momenti.empty.title', locale)}\n\n${
                startedEmpty ? t('momenti.none.body', locale) : t('momenti.empty.body', locale)
              }`}
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

      {showActions ? (
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

      {suggestion.data ? (
        <View className="mt-8">
          <SectionLabel className="mb-2">{t('momenti.suggestionsTitle', locale)}</SectionLabel>
          <SuggestionRow suggestion={suggestion.data} locale={locale} />
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
  );
}
