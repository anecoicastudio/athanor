import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import { deleteAccount, privacy, terms, type LegalDoc } from './legal-content';

/**
 * These are the published privacy policy, the terms and the account-deletion page, reachable at
 * /privacy, /terms and /delete-account in both locales. i18n.md's parity rule applies for the same
 * reason it applies to the UI catalog: a section present in one language and missing in the other
 * is a legal document that differs by locale. The site is EU-facing, so an empty section is a
 * compliance gap, not a typo.
 */
const docs: [string, Record<'it' | 'en', LegalDoc>][] = [
  ['privacy', privacy],
  ['terms', terms],
  ['deleteAccount', deleteAccount],
];

const MONTHS: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** "Luglio 2026" / "July 2026" → { month: 7, year: 2026 }. Throws on an unparseable date. */
function monthYear(updated: string): { month: number; year: number } {
  const [rawMonth, rawYear] = updated.trim().split(/\s+/);
  const month = MONTHS[(rawMonth ?? '').toLowerCase()];
  const year = Number(rawYear);
  if (!month || !Number.isInteger(year)) {
    throw new Error(`unparseable "updated" date: ${JSON.stringify(updated)}`);
  }
  return { month, year };
}

describe.each(docs)('%s', (_name, doc) => {
  it('exists in both locales', () => {
    expect(Object.keys(doc).sort()).toEqual(['en', 'it']);
  });

  it('has the same section headings count in IT and EN', () => {
    expect(doc.en.sections.length).toBe(doc.it.sections.length);
  });

  it.each(['it', 'en'] as const)('%s has a title, intro, updated date and review note', (loc) => {
    const d = doc[loc];
    expect(d.title.trim()).not.toBe('');
    expect(d.intro.trim()).not.toBe('');
    expect(d.updated.trim()).not.toBe('');
    expect(d.reviewNote.trim()).not.toBe('');
  });

  it.each(['it', 'en'] as const)('%s has no empty section heading or body', (loc) => {
    for (const [i, section] of doc[loc].sections.entries()) {
      expect(section.heading.trim(), `${loc} section ${i} heading`).not.toBe('');
      expect(section.body.length, `${loc} section ${i} body`).toBeGreaterThan(0);
      for (const para of section.body) expect(para.trim()).not.toBe('');
    }
  });

  it('carries the same "updated" date in both locales', () => {
    // The strings differ by design ("Luglio 2026" / "July 2026"), so compare the date they
    // denote. Two different dates means one translation silently lagged a policy change —
    // and the "last updated" line is the one an authority reads first.
    expect(monthYear(doc.en.updated)).toEqual(monthYear(doc.it.updated));
  });

  it('is genuinely translated, not IT text copied into the EN slot', () => {
    // The failure this catches is a placeholder EN doc that renders Italian to an English
    // reader. Headings are the shortest reliable signal; a handful may legitimately match
    // (proper nouns, "Cookie"), so require most of them to differ.
    const identical = doc.en.sections.filter(
      (s, i) => s.heading === doc.it.sections[i]?.heading,
    ).length;
    expect(identical).toBeLessThan(doc.it.sections.length / 2);
  });
});

describe('controller identification', () => {
  it('names the data controller and a contact address in every locale', () => {
    // GDPR Art. 13(1)(a)-(b): the controller's identity and contact details.
    for (const [, doc] of docs) {
      for (const loc of ['it', 'en'] as const) {
        const text = JSON.stringify(doc[loc]);
        expect(text).toContain('Anecoica Studio');
        expect(text).toMatch(/[\w.]+@[\w.]+\.\w+/);
      }
    }
  });
});

/**
 * /delete-account is the URL in Google Play's Data safety form (#767). Play reads it for four
 * things: the app or developer name as the listing shows it, a deletion pathway that does not
 * send the person back to the app, any step they must take first, and what is kept. The page also
 * has to say what the app says — a label that drifted would walk somebody to a row that is not
 * there — so the in-app steps are asserted against the catalog, not against a copy of it.
 */
describe('deleteAccount', () => {
  const text = (loc: 'it' | 'en') => JSON.stringify(deleteAccount[loc]);

  it.each(['it', 'en'] as const)('%s names the app as the store listing does', (loc) => {
    expect(text(loc)).toContain(t('store.name', loc));
  });

  it.each(['it', 'en'] as const)('%s is titled like the in-app deletion screen', (loc) => {
    expect(deleteAccount[loc].title).toBe(t('account.delete.title', loc));
  });

  it.each(['it', 'en'] as const)("%s walks the in-app path with the app's own labels", (loc) => {
    const steps = deleteAccount[loc].sections[0]!.body.join('\n');
    for (const key of [
      'tabs.profile',
      'settings.title',
      'settings.section.privacy',
      'account.delete.row',
      'account.delete.confirmWord',
      'account.delete.cta',
    ] as const) {
      expect(steps, key).toContain(t(key, loc));
    }
  });

  it.each(['it', 'en'] as const)(
    '%s names the confirm word of BOTH app languages — the app, not this page, sets which one applies',
    (loc) => {
      const steps = deleteAccount[loc].sections[0]!.body.join('\n');
      expect(steps).toContain(t('account.delete.confirmWord', 'it'));
      expect(steps).toContain(t('account.delete.confirmWord', 'en'));
    },
  );

  it.each(['it', 'en'] as const)(
    "%s carries the app's deferral line verbatim, so the two cannot promise different things",
    (loc) => {
      expect(text(loc)).toContain(JSON.stringify(t('account.delete.deferred', loc)).slice(1, -1));
    },
  );

  it.each(['it', 'en'] as const)('%s offers the same contact address as /privacy', (loc) => {
    // A deletion route for somebody who cannot sign in, and the controller's published address
    // for data requests — one address, not a second one only this page knows.
    const address = /[\w.]+@[\w.]+\.\w+/;
    const published = JSON.stringify(privacy[loc]).match(address)?.[0];
    expect(published).toBeDefined();
    expect(deleteAccount[loc].sections[1]!.body.join('\n')).toContain(published);
  });

  it('says in both locales that no reinstall is needed', () => {
    expect(deleteAccount.it.sections[1]!.body.join('\n')).toMatch(/non serve reinstallare/i);
    expect(deleteAccount.en.sections[1]!.body.join('\n')).toMatch(/don't need to reinstall/i);
  });

  it('names the Circle subscription as the one step a person might think they owe first', () => {
    // Play: «If the user needs to take additional steps before deleting their account (for
    // example, canceling a subscription), this must be clearly outlined». Here the step is ours —
    // erasure-job cancels the subscription — and the page has to say so.
    expect(text('it')).toMatch(/Circle[^"]*lo annulliamo noi/);
    expect(text('en')).toMatch(/Circle[^"]*we cancel it/);
  });

  it('states the ten-year payment retention in both locales', () => {
    expect(text('it')).toMatch(/dieci anni/);
    expect(text('en')).toMatch(/ten years/);
  });

  it('never gives the webhook ledger a retention window it does not have', () => {
    // MIGRATIONS-ERRATA: stripe_webhook_events is redacted at erasure and has NO retention
    // window — the ten-year reaper never touches it. The ten years belong to the three payment
    // tables only, so the ledger paragraph must not borrow them.
    const ledger = (loc: 'it' | 'en') =>
      deleteAccount[loc].sections.at(-1)!.body.find((p) => /Stripe/.test(p) && /notific/i.test(p));
    expect(ledger('it')).toBeDefined();
    expect(ledger('en')).toBeDefined();
    expect(ledger('it')).not.toMatch(/anni/);
    expect(ledger('en')).not.toMatch(/years/);
  });
});
