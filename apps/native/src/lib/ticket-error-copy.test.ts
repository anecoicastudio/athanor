import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The ticket-checkout guard ladder and the bar that renders its refusals are two files that never
 * import each other: the server's `{error}` strings are the contract between them (#103), and
 * `TicketBar`'s ERROR_COPY is the only thing that turns one into a sentence.
 *
 * Nothing pinned the pair, and #701 found out what that costs. Its new `ticket below minimum
 * price` refusal shipped server-side and fell through ERROR_COPY to `ticket.error.payment` —
 * «the payment didn't go through», about a checkout where no payment was ever attempted and which
 * nothing the BUYER does can fix. The map's own #104 comment describes that exact defect, because
 * the payout arm had already been through it once.
 *
 * So: every 4xx owes its own sentence, because a 4xx is a SPECIFIC refusal — the server knows
 * exactly which gate said no. That is the rule, and it is deliberately not "refusals the buyer can
 * act on": `ticket below minimum price` and `organizer cannot receive payouts` are both 4xx that
 * the buyer can do nothing about, and saying so IS the copy's job. A future guard must not be
 * dropped from the map on the grounds that its subject is the organiser.
 *
 * The 500s deliberately get nothing. A lookup that failed, a seat claim that broke, a Stripe call
 * that threw: those are undifferentiated internal faults, indistinguishable to the person, and they
 * share the fallback `ticket.error.unavailable`. Splitting on the status code is what makes this a
 * rule rather than a list someone has to remember to extend.
 *
 * That fallback used to be `ticket.error.payment`, «the payment didn't go through», and this file
 * once called it the honest answer to the 500s. It was not (#747): every path into the fallback
 * fails BEFORE Checkout opens, so no payment was attempted, and a real decline happens inside
 * Stripe's hosted page, where the bar never sees it. There is no honest use left for a «payment
 * failed» string on this surface, so the key is gone and the last block below keeps it gone.
 *
 * ERROR_COPY is not exported, so this reads both files as text — the source-audit idiom this app
 * uses for every UI guarantee (`environment: 'node'`, nothing renderable is collectable).
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const LADDER = readFileSync(
  `${SRC}../../../supabase/functions/create-ticket-checkout/logic.ts`,
  'utf8',
);
const BAR = readFileSync(`${SRC}components/live/TicketBar.tsx`, 'utf8');

/** Every capture-group-1 of a global match, with the `string | undefined` narrowed away. */
const captures = (source: string, re: RegExp): string[] => [
  ...new Set([...source.matchAll(re)].map((m) => m[1]).filter((v): v is string => v !== undefined)),
];

/** `error('some message', 409)` → the message, for 4xx only. */
const clientRefusals = (source: string): string[] =>
  captures(source, /(?:^|[^.\w])error\(\s*'([^']+)'\s*,\s*4\d{2}\s*\)/g);

describe('every checkout refusal has its own copy (#701)', () => {
  // Pinned before anything is compared: a regex that silently matched nothing would make the
  // assertion below `[] ⊆ anything` and leave this file decorative.
  it('accounts for EVERY error() in the ladder, so no guard slips past the regex', () => {
    // The floor and the anchors below catch a gross extraction failure; they would NOT catch one
    // guard written as error(`…`, 400) with a template literal, which the message regex cannot
    // see. This closes that: every error() call in the file must be a single-quoted literal with
    // a numeric status, so a guard written any other way turns this red instead of vanishing.
    // `[^.\w]` rather than `\b`: `console.` ends on a non-word character, so `\b` would count
    // `console.error(` as a refusal and redden this on a legitimate log line — the same class of
    // confusing-red that makes people delete guards.
    const allCalls = [...LADDER.matchAll(/(?:^|[^.\w])error\(/g)].length;
    const literalCalls = [...LADDER.matchAll(/(?:^|[^.\w])error\(\s*'[^']+'\s*,\s*\d{3}\s*\)/g)]
      .length;
    expect(allCalls).toBeGreaterThan(0);
    expect(
      literalCalls,
      'an error() call is not a single-quoted literal + status; the extraction below cannot see it',
    ).toBe(allCalls);
  });

  it('finds the guard ladder and a non-trivial set of 4xx refusals', () => {
    const found = clientRefusals(LADDER);
    expect(found.length).toBeGreaterThanOrEqual(8);
    // Two anchors from opposite ends of the ladder, so a partial extraction is visible.
    expect(found).toContain('event is free');
    expect(found).toContain('checkout already open');
  });

  it('maps every one of them in TicketBar.ERROR_COPY', () => {
    const unmapped = clientRefusals(LADDER).filter((msg) => !BAR.includes(`'${msg}':`));
    expect(
      unmapped,
      `these refusals reach the buyer as «payment failed», which is false: ${unmapped.join(', ')}`,
    ).toEqual([]);
  });

  it('leaves the 500s unmapped on purpose — they really are «try again»', () => {
    // The converse assertion. Without it, "map everything" would satisfy the test above and the
    // distinction this file is built on would quietly stop being a distinction.
    const failures = captures(LADDER, /(?:^|[^.\w])error\(\s*'([^']+)'\s*,\s*500\s*\)/g);
    expect(failures.length).toBeGreaterThan(0);
    for (const msg of failures) {
      expect(
        BAR,
        `${msg} is a 500; it should fall through to ticket.error.unavailable`,
      ).not.toContain(`'${msg}':`);
    }
  });

  it('every mapped key exists in BOTH catalogs', () => {
    const keys = captures(BAR, /'(ticket\.error\.[A-Za-z]+)'/g);
    expect(keys.length).toBeGreaterThan(8);
    for (const lang of ['it', 'en'] as const) {
      const catalog = JSON.parse(
        readFileSync(`${SRC}../../../packages/i18n/src/catalogs/${lang}.json`, 'utf8'),
      ) as Record<string, string>;
      for (const key of keys) {
        expect(catalog[key], `${lang}.json has no ${key}`).toBeDefined();
      }
    }
  });

  it('falls back to a sentence that claims no payment failed (#747)', () => {
    // The fallback is reached only before Checkout opens, so its copy must not say a payment
    // was attempted. Pinned by key AND by the `ticket.error.*` copy in both catalogs, so the old
    // sentence returning under another ticket error key is caught too — a key outside that
    // namespace is not scanned.
    expect(BAR).toContain("|| 'ticket.error.unavailable', locale)");
    expect(BAR).not.toContain("'ticket.error.payment'");
    for (const lang of ['it', 'en'] as const) {
      const catalog = JSON.parse(
        readFileSync(`${SRC}../../../packages/i18n/src/catalogs/${lang}.json`, 'utf8'),
      ) as Record<string, string>;
      expect(catalog['ticket.error.payment'], `${lang}.json still carries the false key`).toBe(
        undefined,
      );
      const ticketCopy = Object.entries(catalog).filter(([k]) => k.startsWith('ticket.error.'));
      const claimsFailure = /pagamento non è andato|payment didn't go through/i;
      expect(ticketCopy.filter(([, v]) => claimsFailure.test(v))).toEqual([]);
    }
  });
});
