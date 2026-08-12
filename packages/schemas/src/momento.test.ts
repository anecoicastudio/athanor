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
      reasons: ['Condividete: design', 'Cerchi: musica'],
      dreamText: 'Aprire uno studio',
      status: 'pending',
    });
    expect(card.handle).toBe('maria');
  });

  it('parses the accept result', () => {
    expect(acceptMomentResult.parse({ matched: true, conversationId: null }).matched).toBe(true);
  });
});
