import { describe, expect, it } from 'vitest';
import {
  momentoDeckCard,
  momentoProposal,
  momentoStatusUpdate,
  acceptMomentResult,
} from './momento';

describe('momento schemas', () => {
  it('parses a valid proposal row (no affinity in the client shape)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      candidateId: '33333333-3333-3333-3333-333333333333',
      reasons: ['Condividete: design'],
      status: 'pending',
      proposedOn: '2026-06-16',
      passedUntil: null,
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    };
    expect(momentoProposal.parse(row).reasons).toHaveLength(1);
    expect(Object.keys(momentoProposal.shape)).not.toContain('affinity');
  });

  it('rejects an invalid status', () => {
    expect(() => momentoStatusUpdate.parse({ status: 'pending' })).toThrow();
    expect(momentoStatusUpdate.parse({ status: 'accepted' }).status).toBe('accepted');
  });

  it('parses a deck card with peer + dream quote', () => {
    const card = momentoDeckCard.parse({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
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
