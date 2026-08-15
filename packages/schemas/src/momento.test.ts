import { describe, expect, it } from 'vitest';
import { momentoDeckCard, acceptMomentResult } from './momento';

describe('momento schemas', () => {
  it('parses a deck card with peer + dream quote', () => {
    const card = momentoDeckCard.parse({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      displayName: 'Maria Neri',
      avatarPath: 'ma/ma.jpg',
      // Terms, not prose (#273 D) — the card localizes these tag keys per render.
      reasons: [
        { kind: 'shared', tags: ['creativo'] },
        { kind: 'seeking', tags: ['mentor'] },
      ],
      dreamText: 'Aprire uno studio',
    });
    expect(card.handle).toBe('maria');
  });

  it('parses the profession-complementarity reason (#361)', () => {
    const card = momentoDeckCard.parse({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      displayName: null,
      avatarPath: null,
      // Two profession KEYS, caller's craft first — localized per render like the rest.
      reasons: [{ kind: 'profession', tags: ['design', 'sviluppo'] }],
      dreamText: 'Aprire uno studio',
    });
    expect(card.reasons[0]?.kind).toBe('profession');
  });

  it('rejects a reason kind the client cannot render', () => {
    expect(() =>
      momentoDeckCard.parse({
        id: '11111111-1111-1111-1111-111111111111',
        candidateId: '33333333-3333-3333-3333-333333333333',
        handle: 'maria',
        displayName: null,
        avatarPath: null,
        reasons: [{ kind: 'citta', tags: ['milano'] }],
        dreamText: 'Aprire uno studio',
      }),
    ).toThrow();
  });

  it('parses the accept result', () => {
    expect(acceptMomentResult.parse({ matched: true, conversationId: null }).matched).toBe(true);
  });
});
