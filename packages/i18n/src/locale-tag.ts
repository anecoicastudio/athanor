import type { Locale } from './t';

/**
 * BCP-47 tag for `Intl` / `toLocaleString` — the one home for the it-IT/en-GB mapping.
 *
 * It lives in this package rather than in either app because both need it and neither
 * may import the other: it was hand-rolled in `apps/native/src/lib/time.ts`, again in
 * `apps/web/lib/event-format.ts`, and inline at three more `apps/web` call sites (#331).
 *
 * `en-GB`, not `en-US`: Athanor's events are Italian, and en-GB agrees with it-IT on the
 * things a member actually reads — day-before-month dates and a 24-hour clock.
 *
 * `packages/core` formats currency with the same mapping and CANNOT call this — core
 * imports only `@athanor/schemas` (PRD §5 rule 4). Those copies stay hand-rolled by design.
 */
export function localeTag(locale: Locale): 'it-IT' | 'en-GB' {
  return locale === 'it' ? 'it-IT' : 'en-GB';
}
