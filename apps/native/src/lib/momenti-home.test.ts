import { describe, expect, it } from 'vitest';
import type { MomentoDeckCard } from '@athanor/schemas';
import { topWaitingMomento } from './momenti-home';

const card = (id: string, handle: string): MomentoDeckCard => ({
  id,
  candidateId: `${id}-candidate`,
  handle,
  displayName: null,
  avatarPath: null,
  reasons: [{ kind: 'shared', tags: ['artista'] }],
  dreamText: 'Aprire uno studio di ceramica',
});

describe('topWaitingMomento', () => {
  // `undefined` is the only shape the three non-answers share: loading, idle (no session yet)
  // and a cold error all arrive as `deck.data === undefined`. Home renders nothing for all
  // three — no placeholder, no skeleton (see MomentiCard's docblock).
  it('reads every non-answer as «nothing waits»', () => {
    expect(topWaitingMomento(undefined)).toBeNull();
  });

  // An empty deck is a real answer — the member has no pending proposal today — and it lands on
  // the same render as the non-answers ON PURPOSE: the tab-bar ✦ is already the has/hasn't
  // signal, so Home stays silent either way.
  it('reads an empty deck as «nothing waits» too', () => {
    expect(topWaitingMomento([])).toBeNull();
  });

  // Rule #3 (`(tabs)/_layout.tsx:18-19` — "never a numeric count"): Home surfaces ONE card, not
  // "3 Momenti". By identity, not by field: an implementation that rebuilt the card would drop
  // whatever the schema gains next.
  it('takes the first card and only the first, whatever the deck length', () => {
    const [a, b, c] = [card('a', 'ele_yoga'), card('b', 'marta_ceramica'), card('c', 'tino_chef')];
    expect(topWaitingMomento([a, b, c])).toBe(a);
    expect(topWaitingMomento([a])).toBe(a);
    expect(topWaitingMomento([b, a])).toBe(b);
  });

  // The order is the server's (`proposed_on desc, daily_rank asc`), applied inside
  // `get_momenti_deck()` (#273 B). Home never re-ranks — a client sort here would silently
  // disagree with the deck the tab deals from the same cache entry, so the card you tap would
  // not be the card you get.
  it('never re-ranks — position 0 wins even when a later card looks stronger', () => {
    const weak = { ...card('a', 'dario_legno'), reasons: [] };
    const strong = {
      ...card('b', 'sole_designer'),
      reasons: [
        { kind: 'shared' as const, tags: ['artista'] },
        { kind: 'seeking' as const, tags: ['mentor'] },
        { kind: 'offering' as const, tags: ['freelance'] },
      ],
    };
    expect(topWaitingMomento([weak, strong])).toBe(weak);
  });
});
