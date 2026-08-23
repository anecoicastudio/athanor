import { describe, expect, it } from 'vitest';
import {
  acceptMomentResult,
  momentoDeckCard,
  momentoDeckRow,
  momentoReasonKind,
  momentoStatus,
  momentoSuggestion,
} from './momento';

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

// Mirrors momento_proposals.status and the #273 reason terms — the literal list, never a loop
// over the constant.
describe('momento vocabularies', () => {
  it('status is pending | accepted | passed', () => {
    expect(momentoStatus.options).toEqual(['pending', 'accepted', 'passed']);
    for (const bad of ['declined', 'matched', '']) {
      expect(momentoStatus.safeParse(bad).success).toBe(false);
    }
  });

  it('reason kinds are the eight the card can localize', () => {
    expect(momentoReasonKind.options).toEqual([
      'shared',
      'seeking',
      'offering',
      'skills',
      'city',
      'mutualActivity',
      'profession',
      'newDream',
    ]);
    expect(momentoReasonKind.safeParse('affinity').success).toBe(false);
  });
});

describe('momentoDeckRow (get_momenti_deck wire shape)', () => {
  const deckRow = {
    proposal_id: '11111111-1111-1111-1111-111111111111',
    candidate_id: '33333333-3333-3333-3333-333333333333',
    handle: 'maria',
    display_name: 'Maria Neri',
    avatar_path: 'ma/ma.jpg',
    dream_text: 'Aprire uno studio',
    reason_kind: 'affinity',
    shared: ['creativo'],
    seek_hit: [],
    offer_hit: [],
    skills_shared: [],
    city_near: [],
    mutual_activity: [],
    profession_pair: [],
  };

  it('parses a row unchanged', () => {
    expect(momentoDeckRow.parse(deckRow)).toEqual(deckRow);
  });

  it('carries exactly the RPC columns — and never the affinity score (rule #1)', () => {
    expect(Object.keys(momentoDeckRow.shape)).toEqual([
      'proposal_id',
      'candidate_id',
      'handle',
      'display_name',
      'avatar_path',
      'dream_text',
      'reason_kind',
      'shared',
      'seek_hit',
      'offer_hit',
      'skills_shared',
      'city_near',
      'mutual_activity',
      'profession_pair',
    ]);
    expect(momentoDeckRow.parse({ ...deckRow, affinity: 0.93 })).not.toHaveProperty('affinity');
  });

  it('reason_kind is affinity | new_dream — the two ways a card reaches the deck', () => {
    expect(momentoDeckRow.shape.reason_kind.options).toEqual(['affinity', 'new_dream']);
    expect(momentoDeckRow.parse({ ...deckRow, reason_kind: 'new_dream' }).reason_kind).toBe(
      'new_dream',
    );
    expect(momentoDeckRow.safeParse({ ...deckRow, reason_kind: 'random' }).success).toBe(false);
  });

  it('requires dream_text — the RPC drops a candidate with no active dream', () => {
    expect(momentoDeckRow.safeParse({ ...deckRow, dream_text: null }).success).toBe(false);
  });
});

describe('momentoSuggestion', () => {
  it('is the peer identity, a nullable dream quote and the reason kinds — never a score', () => {
    expect(Object.keys(momentoSuggestion.shape)).toEqual([
      'candidateId',
      'handle',
      'displayName',
      'avatarPath',
      'dreamText',
      'reasons',
    ]);
    const row = {
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: null,
      displayName: null,
      avatarPath: null,
      dreamText: null,
      reasons: ['skills', 'city'],
    };
    expect(momentoSuggestion.parse(row)).toEqual(row);
  });

  it('rejects an empty reasons array — every row has a chip to show', () => {
    expect(
      momentoSuggestion.safeParse({
        candidateId: '33333333-3333-3333-3333-333333333333',
        handle: null,
        displayName: null,
        avatarPath: null,
        dreamText: null,
        reasons: [],
      }).success,
    ).toBe(false);
  });

  it('rejects a kind outside the momentoReasonKind vocabulary', () => {
    expect(
      momentoSuggestion.safeParse({
        candidateId: '33333333-3333-3333-3333-333333333333',
        handle: null,
        displayName: null,
        avatarPath: null,
        dreamText: null,
        reasons: ['altaAffinita'],
      }).success,
    ).toBe(false);
  });
});
