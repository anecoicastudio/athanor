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
