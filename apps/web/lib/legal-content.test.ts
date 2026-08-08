import { describe, expect, it } from 'vitest';
import { privacy, terms, type LegalDoc } from './legal-content';

/**
 * These are the published privacy policy and terms, reachable at /privacy and /terms in both
 * locales. i18n.md's parity rule applies for the same reason it applies to the UI catalog: a
 * section present in one language and missing in the other is a legal document that differs by
 * locale. The site is EU-facing, so an empty section is a compliance gap, not a typo.
 */
const docs: [string, Record<'it' | 'en', LegalDoc>][] = [
  ['privacy', privacy],
  ['terms', terms],
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
