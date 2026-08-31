import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import type { Locale, MomentoSuggestion } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { Tag } from '@/components/Tag';
import { reasonChipLabel } from '@/lib/momenti-reason';

/**
 * «Ti potrebbe interessare» curated-lite row (frontend §2) → read-only Person Detail.
 *
 * The trailing marker is a quiet `Tag`, not a cyan pill. This is a DELIBERATE DEVIATION from
 * the ratified prototype (`chip live`, athanor-prototype.html:1391) and frontend spec
 * `05-m5-momenti.md` §70, user-approved 2026-08-08 — not a spec correction, and not a rule-#4
 * fix either: aura-soft/aura-line WITHOUT a shadow is the ordinary accent surface (~50 sites,
 * incl. Chip's selected state), and the glow rule 4 reserves is auraGlow(), which this never had.
 *
 * The reason is affordance: every other cyan aura-soft pill in this app is interactive or
 * stateful (Chip selected, filter tabs, the retry pressable on this same screen), so a static
 * cyan pill inside a Pressable row reads as a control it isn't. `Tag` is the app's static
 * equivalent — IncomingOfferRow uses the identical Avatar + flex-1 + Tag composition.
 * Don't "restore" the cyan without resolving that.
 *
 * The Tag is `quiet` and the dream is `ink-2`: the marker ANNOTATES the row, the dream IS the
 * row. A default-tone Tag would put `foreground` on the metadata and leave the payload below it
 * — the same inversion the cyan pill had. Keep the payload above the label.
 *
 * The Tag names the REASON — «Sapete fare», «Vicino a te» — from `momenti.reason.chip.*`, the
 * SHORT vocabulary this surface owns (#526), not the `momenti.reason.*` clauses the deck's
 * AffinityRow splices its terms into. Five of the eight read identically; three did not fit the
 * pill at 375/390 and say it shorter here. Until #124 the chip was the fixed «Sogno nuovo»,
 * because get_momenti_suggestion ranked by newest dream and computed no affinity at all; the row
 * now shows what the two actually have in common, and «Sogno nuovo» survives as
 * `momenti.reason.chip.newDream` — the honest chip for the cold-start arm, where there still is
 * no ranking.
 *
 * `reasons[0]` and nothing else: the kinds arrive already ranked by REASON_PRIORITY, and the row
 * has one line of chrome. It never shows a score — a suggestion carries kinds, never a number
 * (rule #3), and `affinity` is not in the RPC's projection to begin with.
 */
export function SuggestionRow({
  suggestion,
  locale,
}: {
  suggestion: MomentoSuggestion;
  locale: Locale;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/(modal)/user/${suggestion.candidateId}`)}
      className="min-h-[56px] flex-row items-center gap-3 rounded-card border border-hair bg-raise px-4 py-3"
    >
      <Avatar
        handle={suggestion.handle}
        displayName={suggestion.displayName}
        avatarPath={suggestion.avatarPath}
        size={48}
      />
      {/* Plain `flex-1`: no floor. This column is basis-0 with grow 1, so it already takes every
          pixel the pill does not need — a `min-w` on top of that pushes it past its flex result
          and the deficit comes out of the pill instead, which then ellipsizes even a short
          «Cerchi». The bound that matters is the pill's `max-w`, set by `Tag shrink`. */}
      <View className="flex-1">
        {/* numberOfLines: Tag is wider than the pill it replaced, and handles run to 30 chars
            (handleSchema) — without this a long one wraps and breaks the min-h-[56px] rhythm. */}
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {memberLabel(suggestion.displayName, suggestion.handle) ?? '—'}
        </Text>
        {suggestion.dreamText ? (
          <DreamQuote compact numberOfLines={1} text={suggestion.dreamText} />
        ) : null}
      </View>
      {/* `?? 'newDream'`: the schema requires a non-empty array, so this only ever fires if the
          server contract breaks — and «Sogno nuovo» is the right thing to say when we cannot say
          why. It is never a silent blank chip. */}
      <Tag shrink quiet label={reasonChipLabel(suggestion.reasons[0] ?? 'newDream', locale)} />
    </Pressable>
  );
}
