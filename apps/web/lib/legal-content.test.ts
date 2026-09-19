import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import { REPORT_CATEGORIES } from '@athanor/schemas';
import { childSafety, deleteAccount, privacy, terms, type LegalDoc } from './legal-content';

/**
 * These are the published privacy policy, the terms, the account-deletion page and the child
 * safety standards, reachable at /privacy, /terms, /delete-account and /child-safety in both
 * locales. i18n.md's parity rule applies for the same reason it applies to the UI catalog: a
 * section present in one language and missing in the other is a legal document that differs by
 * locale. The site is EU-facing, so an empty section is a compliance gap, not a typo.
 */
const docs: [string, Record<'it' | 'en', LegalDoc>][] = [
  ['privacy', privacy],
  ['terms', terms],
  ['deleteAccount', deleteAccount],
  ['childSafety', childSafety],
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

  it.each(['it', 'en'] as const)('%s gives the renderer unique keys', (loc) => {
    // components/legal-doc.tsx keys a section by its heading and a paragraph by its first 24
    // characters. A duplicate renders with a React key warning and can drop or reorder
    // paragraphs on a locale switch — on a legal page, a paragraph that silently disappears.
    const headings = doc[loc].sections.map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
    for (const section of doc[loc].sections) {
      const keys = section.body.map((p) => p.slice(0, 24));
      expect(new Set(keys).size, section.heading).toBe(keys.length);
    }
  });

  it.each(['it', 'en'] as const)('%s never says «utenti» or "engagement"', (loc) => {
    // i18n.md: people are not metrics, and the legal copy holds the same line as the UI.
    expect(JSON.stringify(doc[loc])).not.toMatch(/\butent[ei]\b|engagement/i);
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
    "%s carries both of the in-app screen's paragraphs verbatim, so the two cannot promise different things",
    (loc) => {
      const paragraphs = deleteAccount[loc].sections.flatMap((s) => s.body);
      expect(paragraphs).toContain(t('account.delete.body', loc));
      expect(paragraphs).toContain(t('account.delete.deferred', loc));
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

  it('says what stays at Stripe — the cascade never touches the Stripe Customer', () => {
    // create-circle-checkout creates the Customer with the member's email and nothing in
    // supabase/functions deletes or redacts it, so «senza i tuoi contatti» about OUR rows would
    // otherwise read as a claim about the payment provider too.
    expect(text('it')).toMatch(/Stripe[^"]*indirizzo email[^"]*non li cancella/);
    expect(text('en')).toMatch(/Stripe[^"]*email address[^"]*does not remove them/);
  });

  it('states the ten-year payment retention as a fact about us, not as a legal duty', () => {
    // Marco's ruling on PR 773: the controller is a German UG and the page cites no law, so the
    // sentence says what we do and why, not what "the law requires". The app's own deferral line
    // («I dati che la legge ci obbliga a conservare…») is quoted verbatim elsewhere and stays.
    const payments = (loc: 'it' | 'en') =>
      deleteAccount[loc].sections.at(-1)!.body.find((p) => /Circle/.test(p))!;
    expect(payments('it')).toMatch(/per dieci anni per i nostri obblighi contabili e fiscali/);
    expect(payments('en')).toMatch(/for ten years for our accounting and tax obligations/);
    expect(payments('it')).not.toMatch(/\blegge\b/i);
    expect(payments('en')).not.toMatch(/\blaw\b|legally/i);
  });

  it.each(['it', 'en'] as const)(
    "%s offers the export before the in-app deletion steps, by the row's own label",
    (loc) => {
      const body = deleteAccount[loc].sections[0]!.body;
      const exportLine = body.findIndex((p) => p.includes(t('settings.export.title', loc)));
      const firstStep = body.findIndex((p) => p.startsWith('1. '));
      expect(exportLine).toBeGreaterThanOrEqual(0);
      expect(exportLine).toBeLessThan(firstStep);
    },
  );

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

  it('points to the privacy policy for everything, not for site visitors only', () => {
    // Before #774 the policy covered the site alone, so this note sent app members elsewhere.
    expect(deleteAccount.it.reviewNote).not.toMatch(/chi visita questo sito/);
    expect(deleteAccount.en.reviewNote).not.toMatch(/people who visit this site/);
  });

  it('names the one ledger event the redaction cannot reach, until something closes it', () => {
    // 20260912070533's accepted limit: a fund contribution's refund or dispute already in the
    // ledger at erasure time keeps its billing details. «We remove your identifying details»
    // with no exception would promise what the cascade does not do.
    const ledger = (loc: 'it' | 'en') => deleteAccount[loc].sections.at(-1)!.body.at(-1)!;
    expect(ledger('it')).toMatch(/tranne[^.]*rimborso[^.]*contributo al fondo/);
    expect(ledger('en')).toMatch(/except[^.]*refund[^.]*fund contribution/);
  });
});

/**
 * /privacy is ONE policy for the app and this site (#774): the app links it from Settings,
 * sign-up and the Circle screen, and it is the URL in the Play Console's privacy field. Until
 * #774 it said it covered the site only and that the app would get its own policy — which never
 * existed. What these pin is the part that must not drift: the scope, the labels a person has to
 * find in the app (read from the catalog, as /delete-account does), and the retention sentences
 * that /delete-account already states — the same words, not a second paraphrase of the cascade.
 * The minimum age and the Aura numbers follow `@athanor/core` (see legal-content.constants.test.ts).
 */
describe('privacy', () => {
  const locales = ['it', 'en'] as const;
  const paragraphs = (loc: 'it' | 'en') => privacy[loc].sections.flatMap((s) => s.body);
  const all = (loc: 'it' | 'en') =>
    [privacy[loc].intro, ...privacy[loc].sections.flatMap((s) => [s.heading, ...s.body])].join(
      '\n',
    );

  it('no longer says it covers the site only, or that the app will get its own policy', () => {
    expect(all('it')).not.toMatch(/solo questo sito|una propria informativa|non in questa/i);
    expect(all('en')).not.toMatch(/this site only|its own policy|not this one/i);
  });

  it.each(locales)('%s names the app as the store listing does, and the site', (loc) => {
    expect(privacy[loc].intro).toContain(t('store.name', loc));
    expect(privacy[loc].intro).toMatch(loc === 'it' ? /questo sito/ : /this site/);
  });

  it.each(locales)('%s has an app part followed by a site part', (loc) => {
    const headings = privacy[loc].sections.map((s) => s.heading);
    const app = loc === 'it' ? "Nell'app:" : 'In the app:';
    const site = loc === 'it' ? 'Sul sito:' : 'On the site:';
    const lastApp = headings.findLastIndex((h) => h.startsWith(app));
    const firstSite = headings.findIndex((h) => h.startsWith(site));
    expect(headings.findIndex((h) => h.startsWith(app))).toBeGreaterThan(0);
    expect(firstSite).toBeGreaterThan(lastApp);
  });

  it.each(locales)(
    "%s walks people to the app's own labels, quoted as the app shows them",
    (loc) => {
      // Quoted, because several labels are also ordinary words («Notifiche», «Momenti») that the
      // prose would contain anyway — an unquoted match could pass with the interpolation gone.
      const text = all(loc);
      const quote = (label: string) => (loc === 'it' ? `«${label}»` : `“${label}”`);
      for (const key of [
        'settings.title',
        'settings.section.privacy',
        'settings.export.title',
        'account.delete.row',
        'account.delete.title',
        'settings.trust.title',
        'gdpr.consent.section',
        'gdpr.consent.diagnostics',
        'settings.notif.title',
        'profile.visibility.label',
        'visibility.public',
        'visibility.members',
        'visibility.private',
        'story.own.pin',
        'live.tab.vicino',
        'momenti.suggestionsTitle',
        'gdpr.location.label',
        'gdpr.consent.comms',
      ] as const) {
        expect(text, key).toContain(quote(t(key, loc)));
      }
    },
  );

  it.each(locales)('%s names Momenti by its catalog name in the heading', (loc) => {
    const headings = privacy[loc].sections.map((s) => s.heading);
    expect(
      headings.some((h) =>
        h.endsWith(`Aura ${loc === 'it' ? 'e' : 'and'} ${t('momenti.title', loc)}`),
      ),
    ).toBe(true);
  });

  it.each(locales)(
    "%s states retention in /delete-account's words and the app's own deferral line",
    (loc) => {
      const ps = paragraphs(loc);
      expect(ps).toContain(t('account.delete.deferred', loc));
      const [deleted, kept] = deleteAccount[loc].sections.slice(-2);
      // `deleted.body[0]` IS the deferral line, asserted above by key.
      for (const p of [...deleted!.body.slice(1), ...kept!.body]) expect(ps).toContain(p);
    },
  );

  it.each(locales)('%s never gives the payment-notification log a retention window', (loc) => {
    // MIGRATIONS-ERRATA: stripe_webhook_events has NO retention window; the ten years belong to
    // the three payment tables only. Every paragraph about Stripe's notifications must say so.
    const ledger = paragraphs(loc).filter((p) => /Stripe/.test(p) && /notific/i.test(p));
    expect(ledger.length).toBeGreaterThanOrEqual(2);
    for (const p of ledger) expect(p).not.toMatch(/anni|years/);
  });

  it.each(locales)(
    '%s states the ten-year retention as a fact about us, not a legal duty',
    (loc) => {
      // Marco's ruling on PR 773 holds here too. The in-app deferral line, quoted verbatim, is the
      // one sentence allowed to name the law, and it names no period.
      const tenYears = paragraphs(loc).filter((p) => /dieci anni|ten years/.test(p));
      expect(tenYears.length).toBeGreaterThan(0);
      for (const p of tenYears) expect(p).not.toMatch(/\blegge\b|\blaw\b|legally/i);
    },
  );

  it.each(locales)("%s publishes one contact address — the controller's", (loc) => {
    // GDPR Art. 13(1)(b), and the address /delete-account sends people to. The app's support
    // mailbox is a different address and must not appear here as a second way in.
    const found = all(loc).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set(['info@anecoica.net']));
  });

  it('claims no parental consent — the app performs no such step', () => {
    expect(all('it')).not.toMatch(/genitor|tutore|responsabilità genitoriale/i);
    expect(all('en')).not.toMatch(/parent|guardian/i);
  });

  it('says a Circle subscription and fund contributions buy no Aura (rule 1)', () => {
    expect(all('it')).toMatch(/Circle[^.]*contributi al fondo non danno punti/);
    expect(all('en')).toMatch(/Circle[^.]*fund contributions earn no points/);
  });

  it('describes contribution records conditionally, as kept when the fund is open', () => {
    // The fund is OFF on production for this release (#249). This pins the conditional; it
    // cannot catch another sentence presenting the fund as live — that is the copy read.
    expect(all('it')).toMatch(/Quando il fondo è aperto/);
    expect(all('en')).toMatch(/When the fund is open/);
  });
});

/**
 * /child-safety is the URL in Google Play's Child Safety Standards declaration (#779). Play reads
 * it for the app or developer name as the listing shows it, a mention of child safety, the way to
 * report inside the app and a point of contact. What these pin beyond that is what must not drift
 * or grow: the app's own report labels (read from the catalog, as /delete-account does), the one
 * address, the hotlines Marco ruled, the promises he ruled, and the claims nothing in the product
 * backs.
 */
describe('childSafety', () => {
  const locales = ['it', 'en'] as const;
  const section = (loc: 'it' | 'en', id: string) => {
    const found = childSafety[loc].sections.find((s) => s.id === id);
    if (!found) throw new Error(`${loc} has no section #${id}`);
    return found;
  };
  const body = (loc: 'it' | 'en', id: string) => section(loc, id).body.join('\n');
  const all = (loc: 'it' | 'en') => {
    const d = childSafety[loc];
    return [
      d.title,
      d.intro,
      ...d.sections.flatMap((s) => [
        s.heading,
        ...s.body,
        ...(s.links ?? []).flatMap((l) => [l.label, l.href]),
      ]),
      d.reviewNote,
    ].join('\n');
  };
  const quote = (loc: 'it' | 'en', label: string) => (loc === 'it' ? `«${label}»` : `“${label}”`);

  it.each(locales)('%s names the app as the store listing does, and its developer', (loc) => {
    expect(childSafety[loc].intro).toContain(t('store.name', loc));
    expect(childSafety[loc].intro).toContain('Anecoica Studio');
  });

  it('says what it is about in its title', () => {
    expect(childSafety.en.title).toMatch(/child safety/i);
    expect(childSafety.it.title).toMatch(/tutela dei minori/i);
  });

  it('gives every section an anchor, the same one in both locales', () => {
    const ids = (loc: 'it' | 'en') => childSafety[loc].sections.map((s) => s.id);
    expect(ids('it').every(Boolean)).toBe(true);
    expect(new Set(ids('it')).size).toBe(ids('it').length);
    expect(ids('en')).toEqual(ids('it'));
  });

  it.each(locales)("%s walks every in-app report path with the app's own labels", (loc) => {
    const steps = body(loc, 'report');
    for (const key of [
      'report.title',
      'chat.report',
      'chat.message.report',
      'tabs.profile',
      'settings.section.privacy',
      'report.behavior.row',
      'report.reason.other',
      'report.cta',
    ] as const) {
      expect(steps, key).toContain(quote(loc, t(key, loc)));
    }
  });

  it('points at «Altro» only while no report reason is about children', () => {
    // The page tells people there is no dedicated reason. A child-safety category (the optional
    // follow-up on #779) makes that false, and this goes red so the page names it instead.
    for (const category of REPORT_CATEGORIES) {
      expect(t(`report.reason.${category}`, 'en'), category).not.toMatch(/child|minor/i);
      expect(t(`report.reason.${category}`, 'it'), category).not.toMatch(/minor|bambin/i);
    }
  });

  it.each(locales)("%s publishes one address — the controller's, as a mailto", (loc) => {
    const found = all(loc).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(new Set(found)).toEqual(new Set(['info@anecoica.net']));
    expect(section(loc, 'contact').links).toEqual([
      { label: 'info@anecoica.net', href: 'mailto:info@anecoica.net' },
    ]);
  });

  it.each(locales)('%s names the point of contact Marco ruled', (loc) => {
    expect(body(loc, 'contact')).toContain('Marco Accardi');
  });

  it('promises the review time Marco ruled — 24 hours', () => {
    expect(body('it', 'action')).toMatch(/entro 24 ore/);
    expect(body('en', 'action')).toMatch(/within 24 hours/);
  });

  it('promises removal, a ban and a report to the authorities', () => {
    // Removal is an operator action until the panel has one (Marco's ruling on #779); the ban and
    // what it hides are resolve_report's and #314's. Nothing weaker, nothing more.
    expect(body('it', 'action')).toMatch(/rimuoviamo il contenuto[^.]*escludiamo/);
    expect(body('en', 'action')).toMatch(/remove the content[^.]*ban/);
    expect(body('it', 'action')).toMatch(/segnaliamo alle autorità competenti/);
    expect(body('en', 'action')).toMatch(/reported to the competent authorities/);
  });

  it('sends people to the police first, then to the hotlines Marco ruled', () => {
    const hotlines = [
      'https://www.jugendschutz.net/en/make-a-report',
      'https://www.fsm.de/en/fsm/hotline/',
      'https://international.eco.de/topics/policy-law/eco-complaints-office/report-a-complaint/',
      'https://www.azzurro.it/clicca-e-segnala/',
      'https://stop-it.savethechildren.it/',
      'https://inhope.org/',
    ];
    for (const loc of locales) {
      const s = section(loc, 'authorities');
      expect(s.body[0]).toMatch(loc === 'it' ? /polizia[^.]*112/ : /police[^.]*112/);
      expect(s.links?.map((l) => l.href)).toEqual(hotlines);
    }
  });

  it.each(locales)('%s claims nothing the product does not do', (loc) => {
    // No scanning, no hash matching, no age verification (the birth date is self-declared) and
    // no copy kept as evidence exist, so none may be promised.
    expect(all(loc)).not.toMatch(
      /scan|hash|automat|verifich\w* l'età|age verification|verif\w* (your |their )?age|evidence|preserv|come prova|conserviamo/i,
    );
  });

  it('points to the privacy policy for the data in a report', () => {
    expect(childSafety.it.reviewNote).toMatch(/informativa sulla privacy/);
    expect(childSafety.en.reviewNote).toMatch(/privacy policy/);
  });
});
