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
  newDream: 'momenti.reason.newDream',
};

/**
 * The tag kinds carry IDENTITY keys — `seeking` holds the identities the candidate has that
 * answer what you seek, `offering` the ones of yours that answer what they seek. `skills`
 * carries skill keys (#123). `city` carries the candidate's city display name — a place, not
 * a catalog key — rendered verbatim rather than pushed through a tag lookup that would only
 * pass it back by luck.
 */
function termLabel(kind: MomentoReasonKind, tag: string, locale: Locale): string {
  if (kind === 'city') return tag;
  return tagLabel(kind === 'skills' ? 'skill' : 'identity', tag, locale);
}

export function momentoReasonText(reason: MomentoReason, locale: Locale): string {
  const prefix = t(REASON_KEY[reason.kind], locale);
  const tags = reason.tags.map((tag) => termLabel(reason.kind, tag, locale));
  return tags.length > 0 ? `${prefix}: ${tags.join(', ')}` : prefix;
}
