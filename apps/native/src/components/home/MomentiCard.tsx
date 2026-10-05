import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { topWaitingMomento } from '@/lib/momenti-home';
import { momentoReasonText } from '@/lib/momenti-reason';
import { useMomentiDeck } from '@/hooks/use-momenti-deck';

/**
 * Home block «Hai un Momento» (PRD 01-m1-identity §4.4 block 6, DESIGN §8.2) — issue #185.
 * The one thing that actually happened to a member, said on Home instead of only as a dot on
 * the tab bar. Its pill routes to the Momenti tab; `topWaitingMomento` decides what
 * (and whether) it shows.
 *
 * THE ONE BORDERED CARD ON HOME (#921, 2026-10-05; DESIGN §6: at most one per screen, for the
 * thing that matters). Every other Home block is bare or a group of rows.
 *
 * NO `fallback` PROP, AND NO PLACEHOLDER — a DELIBERATE DEVIATION from #185's literal text
 * ("a `fallback` prop … is the established shape"), user-approved 2026-08-11. Every sibling
 * that takes one (`DreamHeroCard`, `PrimeStelleCard`) is a block whose MILESTONE hasn't landed:
 * the placeholder promises a feature. This block has landed; its empty state is a fact about
 * today, and «Presto qui» over it would be a lie. #177 settled that a short honest Home beats a
 * full one made of promises, and the tab bar's dot (`hasUnseen` in `(tabs)/_layout.tsx`) is already the
 * has/hasn't signal, so a silent slot loses nothing. Don't add one back.
 *
 * ROUTE-ONLY — a second DELIBERATE DEVIATION, from DESIGN §8.2's `[Scopri][passa]` mockup,
 * which predates the swipe deck. Deciding belongs in the tab now: `acceptMoment` branches into
 * `(modal)/match` plus a toast (the `accept` mutation in `(tabs)/momenti.tsx`), and `passMoment` is
 * destructive for 90 days with no undo (`passMoment` in `packages/api/src/momenti.ts`). A stray tap
 * on a scrolling Home must not be able to spend either. Don't "restore" the buttons from the
 * mockup.
 *
 * Same `useMomentiDeck()` entry as the tab bar's dot, with NO options: TanStack
 * dedupes the two observers, so this block costs zero extra network (`staleTime: 30_000`,
 * the default in `lib/query-client.ts`). Adding `enabled` / `refetchInterval` / `staleTime` here
 * would fork this observer's behaviour from the dot's for no gain — Home would then be able to
 * show a card the tab bar has no dot for. The tab's accept/pass mutations already invalidate
 * this key (`invalidateMomenti` in `(tabs)/momenti.tsx`), so acting there refreshes Home on return
 * with no wiring.
 *
 * An error WITH cached data still renders: tapping through re-reads the deck in the tab, which
 * owns an error branch and a retry (the `deck.isError` branch of `(tabs)/momenti.tsx`). This
 * deliberately is NOT the isError-wins rule of `lib/aura-display.ts` — a stale Aura number is a
 * claim about a person's worth, a stale proposal costs one wasted tap.
 *
 * The card is `Card` (DESIGN §9): `surface`, radius 28, a hairline. It had a cyan border
 * until 2026-10-05. Nothing glows.
 *
 * The pill is the one control (#921, 2026-10-05): the card itself is a plain view, where
 * before the whole card was one `Pressable` named «Hai un Momento in attesa». A pressable
 * card cannot hold a pill (no nested pressables, `source-audit` §21), and the prototype draws
 * the pill. So the label, the name, the reason and the quote are read as text now, and the
 * pill is named by its own visible words, «Scopri chi è ›»: a control whose spoken name is not
 * its label cannot be asked for by that label. The card's old sentence, `home.momenti.a11y`,
 * left the catalog with it.
 *
 * ONE reason, as a grey line led by a ✓, written here and not through `momenti/AffinityRow`:
 * that row is the Momenti tab's, a body line in foreground (its ✓ was cyan until 2026-10-05).
 *
 * The cyan here is the 8px dot beside the label, and nothing else: the waiting Momento's mark
 * (DESIGN §2.3). The label is plain grey since 2026-10-04.
 */
export function MomentiCard({ locale }: { locale: Locale }) {
  const router = useRouter();

  const deck = useMomentiDeck();
  const top = topWaitingMomento(deck.data);

  // Nothing waits, or nothing is known yet — the slot collapses entirely (see docblock).
  if (!top) return null;

  // A card always carries a dream — `get_momenti_deck()` inner-joins the candidate's newest
  // active dream — but `reasons` can be empty when the candidate has masked every term, so the
  // guard below stays.
  //
  // [0] is the BEST reason, not the first one the RPC happened to emit: `rowToDeckCard` ranks
  // them (`rankReasons`, #384). This widget has one line to spend, so it spends it on the term
  // that says the most — verified co-attendance before a shared identity label.
  const reason = top.reasons[0];

  return (
    <Card>
      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-aura" />
        <SectionLabel>{t('momenti.eyebrow', locale)}</SectionLabel>
      </View>
      <View className="flex-row items-center gap-[14px]">
        <Avatar
          decorative
          handle={top.handle}
          displayName={top.displayName}
          avatarPath={top.avatarPath}
          size={44}
        />
        <View className="flex-1 gap-0.5">
          {/* numberOfLines: handles run to 30 chars (handleSchema) and would wrap the row. */}
          <Text numberOfLines={1} className="type-h2 text-foreground">
            {memberLabel(top.displayName, top.handle) ?? '—'}
          </Text>
          {/* ONE reason, not MomentoCard's three: the tab is where the full case gets made. */}
          {reason ? (
            <Text className="type-small text-muted-foreground">
              ✓ {momentoReasonText(reason, locale)}
            </Text>
          ) : null}
        </View>
      </View>
      {top.dreamText ? <DreamQuote compact numberOfLines={2} text={top.dreamText} /> : null}
      <Button label={t('home.momenti.cta', locale)} onPress={() => router.push('/momenti')} />
    </Card>
  );
}
