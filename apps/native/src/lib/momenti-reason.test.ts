import { describe, expect, it } from 'vitest';
import { momentoReasonText } from './momenti-reason';

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
