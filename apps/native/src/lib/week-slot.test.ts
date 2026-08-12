import { describe, expect, it } from 'vitest';
import type { WeekRecap } from '@athanor/core';
import { weekRecapIsEmpty } from './week-slot';

// `weekSlotState`'s cases moved to `list-state.test.ts` when it folded into `listState` (#111).
// What is left here is the domain question — what counts as a quiet week — which never was
// about queries.

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
