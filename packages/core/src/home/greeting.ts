/**
 * Time-of-day greeting bucket for the Home header («Buongiorno» / «Buon
 * pomeriggio» / «Buonasera»). Pure — the caller injects the hour (app layer
 * reads the clock); core never touches `Date.now()` (core.md rule). The string
 * itself is resolved via `@auria/i18n` `home.greeting.*` at the call site.
 */
export type Greeting = 'morning' | 'afternoon' | 'evening';

export function greetingFor(hour: number): Greeting {
  if (!Number.isFinite(hour)) return 'morning';
  const h = Math.floor(hour);
  if (h < 0 || h > 23) return 'morning';
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}
