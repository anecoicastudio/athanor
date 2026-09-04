import type { MomentoReasonKind } from '@athanor/schemas';
import { describe, expect, it } from 'vitest';
import { MOMENTO_DECK_REASON_LIMIT, REASON_PRIORITY, rankReasons } from './reasons';

/**
 * The display policy #384 made explicit. It used to be implicit twice over: the array
 * order inside `rowToDeckCard` and a `.slice(0, 3)` in the swipe card, which together
 * meant the seven terms rendered in the order they happened to be written — so the
 * newest and hardest-earned terms (mutual activity, complementary crafts) sat last and
 * were structurally invisible behind three identity labels.
 */

const reason = (kind: MomentoReasonKind, tags: string[] = ['x']) => ({ kind, tags });

describe('REASON_PRIORITY', () => {
  it('ranks every reason kind exactly once', () => {
    const kinds: MomentoReasonKind[] = [
      'shared',
      'seeking',
      'offering',
      'skills',
      'city',
      'mutualActivity',
      'profession',
      'newDream',
    ];
    expect([...REASON_PRIORITY].sort()).toEqual([...kinds].sort());
  });

  it('puts the hardest-earned terms first and the ambient ones last', () => {
    // The ordering claim itself, as a value: verified co-attendance beats a ruled craft
    // pairing, which beats a stated need, which beats a shared label, which beats being
    // in the same 20 km cell. «Vicino a te» is a fact about geography, not about them.
    expect(REASON_PRIORITY).toEqual([
      'mutualActivity',
      'profession',
      'seeking',
      'offering',
      'skills',
      'shared',
      'city',
      'newDream',
    ]);
  });
});

describe('MOMENTO_DECK_REASON_LIMIT', () => {
  it('is narrower than the number of kinds, which is why the ranking has to exist', () => {
    // If a card could show every term the order would be cosmetic. It cannot, so the
    // order decides what a member ever learns about a candidate.
    expect(MOMENTO_DECK_REASON_LIMIT).toBeLessThan(REASON_PRIORITY.length);
    expect(MOMENTO_DECK_REASON_LIMIT).toBeGreaterThan(0);
  });

  it("is three — the swipe card's room, stated once instead of sliced at each surface", () => {
    expect(MOMENTO_DECK_REASON_LIMIT).toBe(3);
  });
});

describe('rankReasons', () => {
  it('orders reasons by priority, not by the order they arrived in', () => {
    const ranked = rankReasons([reason('city'), reason('shared'), reason('mutualActivity')], 3);
    expect(ranked.map((r) => r.kind)).toEqual(['mutualActivity', 'shared', 'city']);
  });

  it('keeps the hardest-earned terms when the limit cuts', () => {
    // The bug, stated: seven terms and room for three. Before #384 this returned
    // shared/seeking/offering every time and the co-attendance never showed.
    const ranked = rankReasons(
      [
        reason('shared'),
        reason('seeking'),
        reason('offering'),
        reason('skills'),
        reason('city'),
        reason('mutualActivity'),
        reason('profession'),
      ],
      3,
    );
    expect(ranked.map((r) => r.kind)).toEqual(['mutualActivity', 'profession', 'seeking']);
  });

  it('returns the single best reason at a limit of one — the home widget has one line', () => {
    const ranked = rankReasons([reason('shared'), reason('city'), reason('profession')], 1);
    expect(ranked.map((r) => r.kind)).toEqual(['profession']);
  });

  it('returns every reason when the limit is wider than the list', () => {
    const ranked = rankReasons([reason('city'), reason('skills')], 10);
    expect(ranked.map((r) => r.kind)).toEqual(['skills', 'city']);
  });

  it('returns nothing at a limit of zero or below', () => {
    // Both cases carry more than one reason deliberately: a negative limit reaching
    // `slice` means `slice(0, -1)`, which quietly returns all-but-the-last instead of
    // nothing, and a one-element list cannot tell the two apart.
    expect(rankReasons([reason('shared'), reason('city')], 0)).toEqual([]);
    expect(rankReasons([reason('shared'), reason('city')], -1)).toEqual([]);
  });

  it('carries the reason through untouched — it ranks, it never rewrites', () => {
    const input = [reason('mutualActivity', ['Serata Alpha', 'Serata Beta'])];
    expect(rankReasons(input, 3)).toEqual([
      { kind: 'mutualActivity', tags: ['Serata Alpha', 'Serata Beta'] },
    ]);
  });

  it('does not mutate the list it was given', () => {
    const input = [reason('city'), reason('mutualActivity')];
    rankReasons(input, 2);
    expect(input.map((r) => r.kind)).toEqual(['city', 'mutualActivity']);
  });

  it('ranks a newDream card, which never travels with other reasons', () => {
    expect(rankReasons([reason('newDream', [])], 3).map((r) => r.kind)).toEqual(['newDream']);
  });

  it('sorts an unranked kind last rather than dropping or throwing', () => {
    // The kinds come from a Zod enum, so this is unreachable through the deck — but a
    // reason the UI cannot rank must still render, and a term silently disappearing is
    // the exact failure #384 exists to remove.
    const ranked = rankReasons(
      [{ kind: 'quantum' as MomentoReasonKind, tags: ['?'] }, reason('city')],
      2,
    );
    expect(ranked.map((r) => r.kind)).toEqual(['city', 'quantum']);
  });

  it('keeps two same-kind reasons in the order they arrived', () => {
    // Stability matters even though `rowToDeckCard` emits each kind at most once: an
    // unstable sort would let a deck reorder its own reason lines between two reads.
    const ranked = rankReasons([reason('city', ['Monza']), reason('city', ['Como'])], 2);
    expect(ranked.map((r) => r.tags[0])).toEqual(['Monza', 'Como']);
  });

  it('handles an empty list', () => {
    expect(rankReasons([], 3)).toEqual([]);
  });
});
