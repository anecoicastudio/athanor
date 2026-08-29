import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { AffinityRow } from '@/components/momenti/AffinityRow';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { SectionLabel } from '@/components/SectionLabel';
import { topWaitingMomento } from '@/lib/momenti-home';
import { useMomentiDeck } from '@/hooks/use-momenti-deck';

/**
 * Home block «Hai un Momento» (PRD 01-m1-identity §4.4 block 6, DESIGN §8.2) — issue #185.
 * The one thing that actually happened to a member, said on Home instead of only as a ✦ on
 * the tab bar. The whole card routes to the Momenti tab; `topWaitingMomento` decides what
 * (and whether) it shows.
 *
 * NO `fallback` PROP, AND NO PLACEHOLDER — a DELIBERATE DEVIATION from #185's literal text
 * ("a `fallback` prop … is the established shape"), user-approved 2026-08-11. Every sibling
 * that takes one (`DreamHeroCard`, `PrimeStelleCard`) is a block whose MILESTONE hasn't landed:
 * the placeholder promises a feature. This block has landed; its empty state is a fact about
 * today, and «Presto qui» over it would be a lie. #177 settled that a short honest Home beats a
 * full one made of promises, and the tab-bar ✦ (`(tabs)/_layout.tsx:16-19`) is already the
 * has/hasn't signal, so a silent slot loses nothing. Don't add one back.
 *
 * ROUTE-ONLY — a second DELIBERATE DEVIATION, from DESIGN §8.2's `[Scopri][passa]` mockup,
 * which predates the swipe deck. Deciding belongs in the tab now: `acceptMoment` branches into
 * `(modal)/match` plus a toast (`(tabs)/momenti.tsx:55-73`), and `passMoment` is destructive for
 * 90 days with no undo (`packages/api/src/momenti.ts:143-153`). A stray tap on a scrolling Home
 * must not be able to spend either. Don't "restore" the buttons from the mockup.
 *
 * Same `useMomentiDeck()` entry as the tab-bar badge, with NO options: TanStack
 * dedupes the two observers, so this block costs zero extra network (`staleTime: 30_000`,
 * `lib/query-client.ts:13`). Adding `enabled` / `refetchInterval` / `staleTime` here would fork
 * this observer's behaviour from the badge's for no gain — Home would then be able to show a
 * card the tab bar doesn't spark for. The tab's accept/pass mutations already invalidate this
 * key (`(tabs)/momenti.tsx:71,77`), so acting there refreshes Home on return with no wiring.
 *
 * An error WITH cached data still renders: tapping through re-reads the deck in the tab, which
 * owns an error branch and a retry (`(tabs)/momenti.tsx:110-120`). This deliberately is NOT the
 * isError-wins rule of `lib/aura-display.ts` — a stale Aura number is a claim about a person's
 * worth, a stale proposal costs one wasted tap.
 *
 * Flat, per DESIGN §9 ("Moment cards add 1px `aura` border" — border, not shadow): the
 * `border-aura-line bg-raise` recipe is `MomentoCard.tsx:25` minus its `flex-1` wrapper, so Home
 * and the tab render the same object. No `auraGlow()` — rule #4 permits one here but every glow
 * site in the app is a terminal confirmation (the match), not an invitation.
 *
 * One a11y label on the Pressable, like all three Home siblings (`DreamHeroCard.tsx:78`,
 * `StarsMiniRow.tsx:39`, `InviteCard.tsx:41`): VoiceOver reads one node, so it costs the peer's
 * handle. The trade is deliberate — `handle` is nullable, and a `{name}` label would read the
 * «—» fallback aloud as "dash".
 *
 * `tone="aura"` is safe HERE only because Home has no other cyan eyebrow — `SectionLabel.tsx:12`
 * warns that a second one costs the first its rank. Check that before adding one.
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
    <Pressable
      className="gap-3"
      accessibilityRole="button"
      accessibilityLabel={t('home.momenti.a11y', locale)}
      onPress={() => router.push('/momenti')}
    >
      <SectionLabel tone="aura">{t('momenti.eyebrow', locale)}</SectionLabel>
      <View className="gap-3 rounded-card border border-aura-line bg-raise p-5">
        <View className="flex-row items-center gap-3">
          <Avatar
            handle={top.handle}
            displayName={top.displayName}
            avatarPath={top.avatarPath}
            size={48}
          />
          <View className="flex-1">
            {/* numberOfLines: handles run to 30 chars (handleSchema) and would wrap the row. */}
            <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
              {memberLabel(top.displayName, top.handle) ?? '—'}
            </Text>
            {/* ONE reason, not MomentoCard's three: the tab is where the full case gets made. */}
            {reason ? <AffinityRow reason={reason} locale={locale} /> : null}
          </View>
          <Text className="text-lg text-aura">✦</Text>
        </View>
        {top.dreamText ? <DreamQuote compact numberOfLines={2} text={top.dreamText} /> : null}
        <Text className="text-[13px] text-aura">{t('home.momenti.cta', locale)}</Text>
      </View>
    </Pressable>
  );
}
