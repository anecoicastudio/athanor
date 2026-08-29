import { describe, expect, it } from 'vitest';
import { momentiDeckView } from './momenti-deck-state';

/** A settled read of a deck holding `n` cards, before any swipe. */
const settled = (n: number) => ({
  isLoading: false,
  isError: false,
  isSuccess: true,
  cardCount: n,
  sweptThrough: false,
});

describe('momentiDeckView', () => {
  // The whole point of #594: «Hai un Momento» is a claim, and a claim may only be made once a
  // read has settled AND left a card on the stack. The three non-answers below each used to
  // carry it.
  it('claims a Momento only when a card is on the stack', () => {
    expect(momentiDeckView(settled(2)).hasMomento).toBe(true);
  });

  it('claims nothing while the read is in flight', () => {
    const view = momentiDeckView({
      isLoading: true,
      isError: false,
      isSuccess: false,
      cardCount: 0,
      sweptThrough: false,
    });
    expect(view).toEqual({ hasMomento: false, exhausted: false, neverHadOne: false });
  });

  // A failed read is the absence of an answer, not an answer — the same distinction #111 drew
  // one layer down, where the error arm had borrowed the empty state's sentence.
  it('claims nothing when the read failed, even over cached cards', () => {
    const view = momentiDeckView({
      isLoading: false,
      isError: true,
      isSuccess: false,
      cardCount: 3,
      sweptThrough: false,
    });
    expect(view.hasMomento).toBe(false);
    expect(view.exhausted).toBe(false);
    expect(view.neverHadOne).toBe(false);
  });

  // `idle`: TanStack reports `isLoading: false` with no data when a query has not started. The
  // screen has no `enabled` gate today, so this is latent — asserted so it stays silent if one
  // is ever added, rather than asserting emptiness.
  it('claims nothing on a read that never started', () => {
    const view = momentiDeckView({
      isLoading: false,
      isError: false,
      isSuccess: false,
      cardCount: 0,
      sweptThrough: false,
    });
    expect(view).toEqual({ hasMomento: false, exhausted: false, neverHadOne: false });
  });

  it('is exhausted, and says «never had one», on a deck that arrived empty', () => {
    expect(momentiDeckView(settled(0))).toEqual({
      hasMomento: false,
      exhausted: true,
      neverHadOne: true,
    });
  });

  // The bug the extraction protects: both mutations invalidate the deck, so swiping through
  // makes the refetch return [] — indistinguishable from an empty first read by `cardCount`
  // alone. Only the latch separates «we have not found anyone yet» from «you have seen them
  // all», and only the second is true here.
  it('is exhausted WITHOUT «never had one» once the member swiped through', () => {
    expect(momentiDeckView({ ...settled(0), sweptThrough: true })).toEqual({
      hasMomento: false,
      exhausted: true,
      neverHadOne: false,
    });
  });

  // The latch outranks a stale array: `onEmpty` fires before the refetch lands, so for a beat
  // the consumed cards are still in hand. Rendering them would deal a card the member has
  // already answered. The caller clears the latch when a fresh deck arrives.
  it('stays exhausted while a swept-through deck still holds its stale cards', () => {
    const view = momentiDeckView({ ...settled(3), sweptThrough: true });
    expect(view.exhausted).toBe(true);
    expect(view.hasMomento).toBe(false);
    expect(view.neverHadOne).toBe(false);
  });

  // Two claims about the same screen that must never both be made: one says a Momento waits,
  // the other says none ever has.
  it('never claims a Momento and «never had one» at once', () => {
    for (const isLoading of [true, false]) {
      for (const isError of [true, false]) {
        for (const isSuccess of [true, false]) {
          for (const cardCount of [0, 1, 3]) {
            for (const sweptThrough of [true, false]) {
              const view = momentiDeckView({
                isLoading,
                isError,
                isSuccess,
                cardCount,
                sweptThrough,
              });
              expect(view.hasMomento && view.neverHadOne).toBe(false);
              // The eyebrow and the empty state are opposite arms of one branch.
              expect(view.hasMomento && view.exhausted).toBe(false);
            }
          }
        }
      }
    }
  });
});
