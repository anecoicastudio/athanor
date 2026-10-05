import { useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import type { Locale, MomentoSuggestion } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { Row } from '@/components/Row';
import { Tag } from '@/components/Tag';
import { reasonChipLabel } from '@/lib/momenti-reason';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * «Ti potrebbe interessare» curated-lite row (frontend §2) → read-only Person Detail.
 *
 * A `Row` of the screen's `RowGroup` since 2026-10-05 (#921; DESIGN §6: a list is one `surface`
 * block), not a card of its own: the disc in the row's `leading`, the name its title on one
 * line, the dream its second line, the tag its `trailing`. At the accessibility text sizes
 * (`stacksTrailing`) `Row` puts the tag under the text, where it no longer needs its 40% cap.
 * The row is one button and says the name, the dream and the reason.
 *
 * The trailing marker is a quiet `Tag`, not a cyan pill. This is a DELIBERATE DEVIATION from
 * the ratified prototype (`chip live`, athanor-prototype.html:1391) and frontend spec
 * `05-m5-momenti.md` §70, user-approved 2026-08-08 — not a spec correction, and not a rule-#4
 * fix either: aura-soft/aura-line WITHOUT a shadow was the ordinary accent surface (~50 sites,
 * incl. Chip's selected state then), and the glow rule 4 reserved was auraGlow(), which this never had.
 *
 * The reason is affordance: every other cyan aura-soft pill in this app was interactive or
 * stateful (Chip selected, filter tabs, the retry pressable on this same screen), so a static
 * cyan pill inside a Pressable row read as a control it wasn't. `Tag` is the app's static
 * equivalent — IncomingOfferRow uses the same Avatar + flex-1 + Tag composition.
 * Don't "restore" the cyan without resolving that.
 *
 * The Tag is `quiet` and the dream is foreground, in the dream register: the marker ANNOTATES
 * the row, the dream IS the row. A default-tone Tag would put `foreground` on the metadata and
 * leave the payload below it — the same inversion the cyan pill had. Keep the payload above the
 * label. (The Galleria prototype draws the reverse, a grey line and a foreground chip; the
 * 2026-08-08 ruling above stands until Marco says otherwise.)
 *
 * The Tag names the REASON — «Sapete fare», «Vicino a te» — from `momenti.reason.chip.*`, the
 * SHORT vocabulary this surface owns (#526), not the `momenti.reason.*` clauses the deck's
 * AffinityRow splices its terms into. Thirteen of the sixteen read identically; the three that
 * did not fit the pill at 375/390 — `offering` in both locales and `profession` in EN — say it
 * shorter here. Until #124 the chip was the fixed «Sogno nuovo»,
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
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  // `?? 'newDream'`: the schema requires a non-empty array, so this only ever fires if the
  // server contract breaks — and «Sogno nuovo» is the right thing to say when we cannot say
  // why. It is never a silent blank chip.
  const reason = reasonChipLabel(suggestion.reasons[0] ?? 'newDream', locale);
  const name = memberLabel(suggestion.displayName, suggestion.handle) ?? '—';
  const dream = suggestion.dreamText;
  return (
    <Row
      leading={
        <Avatar
          decorative
          handle={suggestion.handle}
          displayName={suggestion.displayName}
          avatarPath={suggestion.avatarPath}
          size={44}
        />
      }
      title={name}
      // One line: handles run to 30 chars (handleSchema), and a long one would wrap beside
      // the pill.
      titleLines={1}
      description={dream ? <DreamQuote compact numberOfLines={1} text={dream} /> : undefined}
      // The row is one button: it says what its three parts show, the dream in its guillemets
      // as `DreamQuote` draws it. Read on the moto g17 on 2026-10-05 (`uiautomator dump`): the
      // node's description is the same text the unlabelled row had.
      accessibilityLabel={[name, dream ? `«${dream}»` : null, reason].filter(Boolean).join(', ')}
      onPress={() => router.push(`/(modal)/user/${suggestion.candidateId}`)}
      showChevron={false}
      // The 40% cap (`shrink`) holds only beside the text: under it the tag has the row.
      trailing={<Tag shrink={!stacked} quiet label={reason} />}
    />
  );
}
