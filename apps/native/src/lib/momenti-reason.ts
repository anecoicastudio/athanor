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
  newDream: 'momenti.reason.newDream',
};

export function momentoReasonText(reason: MomentoReason, locale: Locale): string {
  const prefix = t(REASON_KEY[reason.kind], locale);
  // Every term carries IDENTITY keys — `seeking` holds the identities the candidate has that
  // answer what you seek, `offering` the ones of yours that answer what they seek.
  const tags = reason.tags.map((tag) => tagLabel('identity', tag, locale));
  return tags.length > 0 ? `${prefix}: ${tags.join(', ')}` : prefix;
}
