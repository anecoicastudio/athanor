import type { MessageKey } from '@athanor/i18n';

/**
 * The sixteen pre-payment disclosures in six blocks (FUND-18, FUND-SPEC §3, #235).
 *
 * The spec owns which fact appears in which block; the i18n catalog owns the words
 * (IT canonical). Extracted from the screen for the same reason as `fund-cycle.ts`:
 * a structure left inside a component is structurally unassertable —
 * `fund-disclosure.test.ts` pins every key by name, and the screen renders THIS
 * array, so a fact cannot be dropped from the render without failing the test.
 *
 * Six titled blocks, not sixteen flat bullets: wallpaper that looks like consent
 * is worse than nothing.
 */
export type DisclosureBlock = {
  readonly title: MessageKey;
  readonly facts: readonly MessageKey[];
};

export const DISCLOSURE_BLOCKS: readonly DisclosureBlock[] = [
  {
    // ① dove va il denaro
    title: 'fund.disclose.where.title',
    facts: [
      'fund.disclose.where.pool',
      'fund.disclose.where.anyAmount',
      'fund.disclose.where.fees',
    ],
  },
  {
    // ② non è un acquisto
    title: 'fund.disclose.notPurchase.title',
    facts: [
      'fund.disclose.notPurchase.noShare',
      'fund.disclose.notPurchase.noAdvantage',
      'fund.disclose.notPurchase.voteDecides',
    ],
  },
  {
    // ③ non c'è restituzione — `nextDream` is the FUND-18 line PR #375 deferred to #235
    title: 'fund.disclose.noReturn.title',
    facts: [
      'fund.disclose.noReturn.othersDream',
      'fund.disclose.noReturn.notReturned',
      'fund.disclose.noReturn.nextDream',
    ],
  },
  {
    // ④ se il ciclo non riesce — a void carries the money forward (FUND-32: reset on
    // realization only; never §17's flat «azzerato»)
    title: 'fund.disclose.ifFails.title',
    facts: [
      'fund.disclose.ifFails.belowFloor',
      'fund.disclose.ifFails.belowQuorum',
      'fund.disclose.ifFails.winnerDeclines',
      'fund.disclose.ifFails.shortBudget',
    ],
  },
  {
    // ⑤ cosa trattiene Athanor
    title: 'fund.disclose.retains.title',
    facts: ['fund.disclose.retains.percent', 'fund.disclose.retains.equity'],
  },
  {
    // ⑥ conformità normativa
    title: 'fund.disclose.compliance.title',
    facts: ['fund.disclose.compliance.law'],
  },
];
