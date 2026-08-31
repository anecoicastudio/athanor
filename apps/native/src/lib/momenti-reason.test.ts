import { describe, expect, it } from 'vitest';
import { momentoReasonKind } from '@athanor/schemas';
import { momentoReasonText, reasonChipLabel, reasonPrefix } from './momenti-reason';

describe('momentoReasonText', () => {
  it('localizes the prefix AND the tag keys (both locales)', () => {
    // The old server-authored prose localized only the prefix and spliced raw Italian
    // keys into English decks: «You share: artista, creativo» (#273 D).
    const reason = { kind: 'shared' as const, tags: ['artista', 'creativo'] };
    expect(momentoReasonText(reason, 'it')).toBe('Condividete: Artista, Creativo');
    expect(momentoReasonText(reason, 'en')).toBe('You both are: Artist, Creative');
  });

  it('reads the seeking term as the identities that answer it', () => {
    expect(momentoReasonText({ kind: 'seeking', tags: ['mentor'] }, 'it')).toBe('Cerchi: Mentor');
  });

  it('reads the offering term as your own identity', () => {
    expect(momentoReasonText({ kind: 'offering', tags: ['investitore'] }, 'it')).toBe(
      'Potrebbe cercare ciò che offri: Investitore',
    );
  });

  it('localizes the skills term from the skill catalog, not the identity one (#123)', () => {
    const reason = { kind: 'skills' as const, tags: ['illustrazione', 'sviluppo-web'] };
    expect(momentoReasonText(reason, 'it')).toBe('Sapete fare: Illustrazione, Sviluppo web');
    expect(momentoReasonText(reason, 'en')).toBe('You both know: Illustration, Web development');
  });

  it('renders the city term with the display name verbatim — it is a place, not a key (#123)', () => {
    // The server sends the candidate's city display name (never a geohash); there is no
    // tag.* catalog entry for it, and it must not fall through a tag lookup unchanged only
    // by luck.
    expect(momentoReasonText({ kind: 'city', tags: ['Monza'] }, 'it')).toBe('Vicino a te: Monza');
    expect(momentoReasonText({ kind: 'city', tags: ['Monza'] }, 'en')).toBe('Near you: Monza');
  });

  it('renders mutual activity with event titles verbatim — rooms, not catalog keys (#361)', () => {
    // The server sends TITLES of events both members were checked in at; like the city
    // display name, a title is a thing, not a key, and must never hit a tag lookup.
    const reason = { kind: 'mutualActivity' as const, tags: ['Cena sotto le stelle'] };
    expect(momentoReasonText(reason, 'it')).toBe('Avete già condiviso: Cena sotto le stelle');
    expect(momentoReasonText(reason, 'en')).toBe("You've already shared: Cena sotto le stelle");
  });

  it('localizes the profession pair from the profession catalog — crafts, not identities (#361)', () => {
    // The server sends the two profession KEYS, the reader's craft first; both localize
    // from tag.profession.*, never the identity or skill catalogs.
    const reason = { kind: 'profession' as const, tags: ['design', 'sviluppo'] };
    expect(momentoReasonText(reason, 'it')).toBe('Mestieri che si completano: Design, Sviluppo');
    expect(momentoReasonText(reason, 'en')).toBe(
      'Crafts that complete each other: Design, Development',
    );
  });

  it('says the fallback plainly, with no tag list and no affinity claim', () => {
    expect(momentoReasonText({ kind: 'newDream', tags: [] }, 'it')).toBe('Sogno nuovo');
    expect(momentoReasonText({ kind: 'newDream', tags: [] }, 'en')).toBe('New dream');
  });

  it('never renders a dangling colon when the server masked every tag', () => {
    // get_momenti_deck can return an empty term for a candidate who hid the field after
    // the proposal was written; the API drops those, so this is belt and braces.
    expect(momentoReasonText({ kind: 'shared', tags: [] }, 'it')).toBe('Condividete');
  });
});

describe('reasonPrefix', () => {
  it('is the prefix with no tags spliced in — the «Ti potrebbe interessare» chip (#124)', () => {
    expect(reasonPrefix('skills', 'it')).toBe('Sapete fare');
    expect(reasonPrefix('skills', 'en')).toBe('You both know');
  });

  it('reads newDream as «Sogno nuovo» — the cold-start chip, unchanged from before #124', () => {
    expect(reasonPrefix('newDream', 'it')).toBe('Sogno nuovo');
    expect(reasonPrefix('newDream', 'en')).toBe('New dream');
  });

  it('agrees with momentoReasonText whenever the reason carries no tags', () => {
    // The two must not drift: the chip and the deck line name the same overlap, and
    // momentoReasonText is built on this function precisely so they cannot.
    for (const kind of ['mutualActivity', 'profession', 'city', 'shared'] as const) {
      expect(momentoReasonText({ kind, tags: [] }, 'it')).toBe(reasonPrefix(kind, 'it'));
    }
  });
});

describe('reasonChipLabel', () => {
  // #526: `Tag shrink` caps the «Ti potrebbe interessare» pill at 40 % with a two-line clamp,
  // which leaves a 92.4 px text box at 390 and 86.4 px at 375 (measured on Expo web, 13 px
  // HankenGrotesk). Three of the sixteen localized full forms need a THIRD line there and
  // truncate. Marco ruled a short vocabulary for the chip alone on 2026-08-30.
  it('shortens the prefixes that overflowed the pill (#526)', () => {
    expect(reasonChipLabel('offering', 'it')).toBe('Cerca ciò che offri');
    expect(reasonChipLabel('offering', 'en')).toBe('Seeks what you offer');
    expect(reasonChipLabel('profession', 'en')).toBe('Complementary crafts');
  });

  it("keeps profession IT on the deck's words — they fit, and they are the accurate ones", () => {
    // Marco's ruling gave «Mestieri affini» as an EXAMPLE of a short form. It fits (one line at
    // both widths, measured) and it is not used, because it is not what the reason means: the
    // profession term fires only on crafts that COMPLEMENT one another and the map refuses to
    // pair a craft with itself (`packages/core/src/onboarding/affinity.test.ts`), while «affini»
    // — and the English "kindred" this lane first wrote — say same-kind. «Mestieri che si
    // completano» is 26 characters and wraps inside the two lines at 375, so IT needs no short
    // form at all; only the EN string had to move.
    expect(reasonChipLabel('profession', 'it')).toBe('Mestieri che si completano');
    expect(reasonChipLabel('profession', 'it')).toBe(reasonPrefix('profession', 'it'));
  });

  it('leaves the deck on the full form — the two surfaces are separate key sets', () => {
    // AffinityRow (the swipe deck AND the home widget) keeps the sentence: there the prefix is
    // a clause with tags spliced after a colon, and «Cerca ciò che offri: Investitore» would
    // assert what «Potrebbe cercare» deliberately hedges.
    expect(reasonPrefix('offering', 'it')).toBe('Potrebbe cercare ciò che offri');
    expect(reasonPrefix('offering', 'en')).toBe('May be looking for what you offer');
    expect(reasonPrefix('profession', 'en')).toBe('Crafts that complete each other');
    expect(momentoReasonText({ kind: 'offering', tags: ['investitore'] }, 'it')).toBe(
      'Potrebbe cercare ciò che offri: Investitore',
    );
  });

  it('says exactly what the deck says for the six kinds that kept both locales', () => {
    // Thirteen of the sixteen strings are unchanged copy. `offering` moved in both locales and
    // `profession` in EN only, so these six kinds match on both. The keys are still separate,
    // so the chip can move later without touching the deck — but the words must not drift for
    // no reason.
    for (const kind of [
      'shared',
      'seeking',
      'skills',
      'city',
      'mutualActivity',
      'newDream',
    ] as const) {
      for (const locale of ['it', 'en'] as const) {
        expect(reasonChipLabel(kind, locale)).toBe(reasonPrefix(kind, locale));
      }
    }
  });

  it('covers every reason kind in both locales — no chip renders a raw key', () => {
    // t() degrades a missing key to the key itself (#113), so an unmapped kind would ship a
    // pill reading «momenti.reason.chip.skills» rather than throwing.
    for (const kind of momentoReasonKind.options) {
      for (const locale of ['it', 'en'] as const) {
        const label = reasonChipLabel(kind, locale);
        expect(label).not.toMatch(/^momenti\.reason\./);
        expect(label.trim()).not.toBe('');
      }
    }
  });

  it('stays inside the two-line budget the pill clamps at', () => {
    // A character count is a PROXY for the px measurement, and a deliberately conservative
    // one: 26 is the longest label in the current set, not the longest that fits. Measured in
    // the live pill at the narrower 86.4 px box (375), «Mestieri che si completano» — 26 —
    // wraps inside the two lines, while the three strings this issue removed (30, 31, 33) need
    // a third. The real ceiling is therefore somewhere between 26 and 30 and depends on where
    // the words break, not on the count. A 27-character label is not necessarily broken; it
    // means this budget has to be re-measured in the pill before it ships.
    //
    // Not a per-word cap as well: a word wider than the box BREAKS across the two lines here
    // rather than ellipsizing (`scrollHeight === clientHeight` for a 15-character single word
    // at 86.4 px), so word length costs lines but never truncates on its own.
    const CHIP_LABEL_MAX_CHARS = 26;
    for (const kind of momentoReasonKind.options) {
      for (const locale of ['it', 'en'] as const) {
        expect(reasonChipLabel(kind, locale).length).toBeLessThanOrEqual(CHIP_LABEL_MAX_CHARS);
      }
    }
  });
});
