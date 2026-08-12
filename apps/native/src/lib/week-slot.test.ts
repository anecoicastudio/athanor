import { describe, expect, it } from 'vitest';
import type { WeekRecap } from '@athanor/core';
import { weekRecapIsEmpty, weekSlotState } from './week-slot';

const recap = (over: Partial<WeekRecap> = {}): WeekRecap => ({
  auraWeek: 0,
  contributi: 0,
  sogniAiutati: 0,
  oreDonate: 0,
  streakDays: 0,
  ...over,
});

describe('weekRecapIsEmpty', () => {
  it('reads an all-zero week as empty', () => {
    expect(weekRecapIsEmpty(recap())).toBe(true);
  });

  it('reads any of the three live fields as activity', () => {
    expect(weekRecapIsEmpty(recap({ auraWeek: 50 }))).toBe(false);
    expect(weekRecapIsEmpty(recap({ contributi: 1 }))).toBe(false);
    expect(weekRecapIsEmpty(recap({ sogniAiutati: 1 }))).toBe(false);
  });

  // The reason `sogniAiutati` is in the predicate at all. `display.ts:86` counts a
  // `milestone_help` without checking its sign, so a capped award (`withinCap === false` → 0
  // points) records a helped dream that contributes nothing to `auraWeek` or `contributi`. The
  // old two-field test swallowed it and told the member their week was blank.
  it('does not swallow a helped dream that earned zero points', () => {
    expect(weekRecapIsEmpty(recap({ sogniAiutati: 1, auraWeek: 0, contributi: 0 }))).toBe(false);
  });

  // #100 asks for `streakDays` in the predicate on the grounds that a 7–8-day-old event leaves a
  // real streak behind. It does not: `display.ts:90-95` walks back from TODAY and breaks at the
  // first quiet day, so a streak cannot outlive the window that feeds `auraWeek`. This asserts
  // the shape that claim would need — a streak with no Aura — is not reachable from the engine,
  // and so is correctly read as empty if it were ever hand-built.
  it('ignores streakDays, which cannot be positive while auraWeek is zero', () => {
    expect(weekRecapIsEmpty(recap({ streakDays: 3 }))).toBe(true);
  });

  // `oreDonate` is hardcoded `0` in `display.ts:97` and never derived — that is #51. Until it is
  // real, including it would assert a constant.
  it('ignores oreDonate, which the engine never populates', () => {
    expect(weekRecapIsEmpty(recap({ oreDonate: 8 }))).toBe(true);
  });
});

describe('weekSlotState', () => {
  // The bug this whole module exists for: all three of these used to render «Presto qui», a
  // claim that the week recap had not been built. It shipped in M6.
  it('separates the three non-answers that used to share one card', () => {
    expect(weekSlotState({ isPending: true, isError: false, data: undefined })).toBe('pending');
    expect(weekSlotState({ isPending: false, isError: true, data: undefined })).toBe('error');
    expect(weekSlotState({ isPending: false, isError: false, data: recap() })).toBe('empty');
  });

  it('renders the card once there is something to show', () => {
    expect(weekSlotState({ isPending: false, isError: false, data: recap({ auraWeek: 50 }) })).toBe(
      'data',
    );
  });

  // `enabled: !!userId` holds the query while the session hydrates. TanStack reports that as
  // `isPending: true, isError: false, data: undefined` — the same shape as in-flight, which is
  // why the branch keys on `isPending` and not `isLoading` (`isLoading` is false when idle, and
  // an idle query would fall through every branch).
  it('treats an idle, never-started query as pending rather than as an answer', () => {
    expect(weekSlotState({ isPending: true, isError: false, data: undefined })).toBe('pending');
  });

  // Deliberate, and the opposite of what `MomentiCard.tsx:41-44` chose for the deck. A stale week
  // is a claim about what this member earned; the query client persists to AsyncStorage for 24h
  // and Aura decays, so showing yesterday's number as today's is the false confidence
  // `aura-display.ts` already refused for the score.
  it('lets an error win over cached data', () => {
    expect(weekSlotState({ isPending: false, isError: true, data: recap({ auraWeek: 50 }) })).toBe(
      'error',
    );
  });

  // Defensive: a settled query with no data has no week to describe, so it must not fall through
  // to `weekRecapIsEmpty` and assert a quiet week on the strength of nothing.
  it('never reads absent data as a quiet week', () => {
    expect(weekSlotState({ isPending: false, isError: false, data: undefined })).toBe('pending');
  });
});
