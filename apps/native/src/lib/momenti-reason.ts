import { type MessageKey, t, tagLabel } from '@athanor/i18n';
import type { Locale, MomentoReason, MomentoReasonKind } from '@athanor/schemas';

/**
 * One affinity reason, rendered (#273 D).
 *
 * The server used to author this string at match time — prefix localized, tag keys spliced in
 * raw, frozen at insert — which is why an English deck read «You share: artista» and why a
 * whole purge trigger existed to delete rows whose prose had gone stale. `get_momenti_deck()`
 * now returns the TERMS and this builds the sentence per render, in the reader's locale.
 *
 * Lives in `lib/` rather than inside AffinityRow for the reason `momenti-home.ts` does: this
 * app's vitest harness is `environment: 'node'` over `src/**\/*.test.ts`, so copy left in a
 * component is structurally unassertable.
 */
const REASON_KEY: Record<MomentoReasonKind, MessageKey> = {
  shared: 'momenti.reason.shared',
  seeking: 'momenti.reason.seeking',
  offering: 'momenti.reason.offering',
  skills: 'momenti.reason.skills',
  city: 'momenti.reason.city',
  mutualActivity: 'momenti.reason.mutualActivity',
  profession: 'momenti.reason.profession',
  newDream: 'momenti.reason.newDream',
};

/**
 * The tag kinds carry IDENTITY keys — `seeking` holds the identities the candidate has that
 * answer what you seek, `offering` the ones of yours that answer what they seek. `skills`
 * carries skill keys (#123). `city` carries the candidate's city display name and
 * `mutualActivity` event titles (#361) — places and rooms, not catalog keys — rendered
 * verbatim rather than pushed through a tag lookup that would only pass them back by luck.
 * `profession` carries the two profession keys of a complementary pair (#361),
 * localized from tag.profession.*.
 */
function termLabel(kind: MomentoReasonKind, tag: string, locale: Locale): string {
  if (kind === 'city' || kind === 'mutualActivity') return tag;
  if (kind === 'profession') return tagLabel('profession', tag, locale);
  return tagLabel(kind === 'skills' ? 'skill' : 'identity', tag, locale);
}

/**
 * The reason's prefix alone — «Sapete fare», not «Sapete fare: branding».
 *
 * `momentoReasonText` builds its sentence on top of this rather than the two spelling
 * `REASON_KEY[kind]` separately. It was the suggestion chip's label too until #526 — the chip
 * now reads its own shorter vocabulary through `reasonChipLabel`, because three of these
 * sixteen strings do not fit the pill. This one is the DECK's, at full length.
 */
export function reasonPrefix(kind: MomentoReasonKind, locale: Locale): string {
  return t(REASON_KEY[kind], locale);
}

/**
 * The chip's own SHORT vocabulary (#526) — the pill only, never the deck.
 *
 * `Tag shrink` caps the «Ti potrebbe interessare» pill at 40 % of the row with a two-line
 * clamp, which leaves a 92.4 px text box at a 390 viewport and 86.4 px at 375. Three of the
 * sixteen localized full forms need a THIRD line in that box and truncate: «Potrebbe cercare
 * ciò che offri», "May be looking for what you offer", "Crafts that complete each other".
 * Widening the cap is not the fix — the pixels come out of the member's NAME, and the row is
 * built name > dream > label. Marco ruled a second key set for this surface on 2026-08-30.
 *
 * Separate keys rather than a shortened `REASON_KEY`, because the two surfaces want different
 * grammar. On the deck the prefix is a CLAUSE with the terms spliced after a colon
 * («Potrebbe cercare ciò che offri: Investitore»), where the hedge is load-bearing — affinity
 * is a guess, and the deck has the width to say so. The chip is a LABEL with no terms and one
 * line of chrome, so it names the reason and stops.
 *
 * Five of the eight kinds say the same thing in both registers and are duplicated verbatim.
 * That is deliberate: the chip can move later without dragging the deck's sentence with it.
 */
const CHIP_KEY: Record<MomentoReasonKind, MessageKey> = {
  shared: 'momenti.reason.chip.shared',
  seeking: 'momenti.reason.chip.seeking',
  offering: 'momenti.reason.chip.offering',
  skills: 'momenti.reason.chip.skills',
  city: 'momenti.reason.chip.city',
  mutualActivity: 'momenti.reason.chip.mutualActivity',
  profession: 'momenti.reason.chip.profession',
  newDream: 'momenti.reason.chip.newDream',
};

/**
 * The reason as the suggestion pill says it — short enough to wrap inside the pill's two lines.
 *
 * `reasonPrefix` is still the deck's; the two are asserted against each other in the test for
 * the six kinds that share their wording, so a drift in the five duplicated strings fails.
 */
export function reasonChipLabel(kind: MomentoReasonKind, locale: Locale): string {
  return t(CHIP_KEY[kind], locale);
}

export function momentoReasonText(reason: MomentoReason, locale: Locale): string {
  const prefix = reasonPrefix(reason.kind, locale);
  const tags = reason.tags.map((tag) => termLabel(reason.kind, tag, locale));
  return tags.length > 0 ? `${prefix}: ${tags.join(', ')}` : prefix;
}
