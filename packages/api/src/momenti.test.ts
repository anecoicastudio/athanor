import { describe, expect, it } from 'vitest';
import { momentiKeys, rowToDeckCard } from './momenti';

describe('momentiKeys', () => {
  it('builds stable keys', () => {
    expect(momentiKeys.deck()).toEqual(['momenti', 'deck']);
    expect(momentiKeys.suggestions()).toEqual(['momenti', 'suggestions']);
  });
});

describe('rowToDeckCard', () => {
  it('maps a joined proposal row to a deck card', () => {
    const card = rowToDeckCard({
      id: '11111111-1111-1111-1111-111111111111',
      candidate_id: '33333333-3333-3333-3333-333333333333',
      reasons: ['Condividete: design'],
      status: 'pending',
      candidate: { handle: 'maria', dreams: [{ text: 'Aprire uno studio' }] },
    });
    expect(card).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      reasons: ['Condividete: design'],
      dreamText: 'Aprire uno studio',
      status: 'pending',
    });
  });

  it('tolerates a peer with no active dream', () => {
    const card = rowToDeckCard({
      id: '11111111-1111-1111-1111-111111111111',
      candidate_id: '33333333-3333-3333-3333-333333333333',
      reasons: [],
      status: 'pending',
      candidate: { handle: 'leo', dreams: [] },
    });
    expect(card.dreamText).toBeNull();
  });
});
