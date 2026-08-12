import { describe, expect, it } from 'vitest';
import type { AuraEvent, AuraEventType, Star, StarKey } from '@athanor/schemas';
import { breakdownRows, pickNextStar, summarizeWeek } from './display.ts';

const B = {
  contributi: 188,
  eventi: 146,
  collaborazioni: 170,
  valore: 96,
  recensioni: 112,
  affidabilita: 30,
};

describe('breakdownRows', () => {
  it('returns the six rows in spec order', () => {
    expect(breakdownRows(B).map((r) => r.key)).toEqual([
      'contributi',
      'eventi',
      'collaborazioni',
      'valore',
      'recensioni',
      'affidabilita',
    ]);
  });
  it('normalizes width to the max bucket', () => {
    const rows = breakdownRows(B);
    expect(rows[0]!.width).toBeCloseTo(1); // contributi is the max (188)
    expect(rows[5]!.width).toBeCloseTo(30 / 188);
  });
  it('all-zero breakdown → all widths 0, no NaN', () => {
    const z = {
      contributi: 0,
      eventi: 0,
      collaborazioni: 0,
      valore: 0,
      recensioni: 0,
      affidabilita: 0,
    };
    expect(breakdownRows(z).every((r) => r.width === 0)).toBe(true);
  });
});

const star = (
  starId: StarKey,
  granted: string | null,
  done: number,
  total: number,
  unit = 'tappe',
): Star => ({
  id: starId,
  profileId: 'p',
  starId,
  grantedAt: granted,
  progress: { done, total, unit },
});

describe('pickNextStar', () => {
  it('returns the closest unearned star by ratio', () => {
    const next = pickNextStar([
      star('creatore', null, 1, 2), // 0.50
      star('mentor', null, 1, 3), // 0.33
      star('visionario', '2026-01-01', 3, 3),
    ]);
    expect(next?.starId).toBe('creatore');
    expect(next).toMatchObject({ done: 1, total: 2, unit: 'tappe' });
  });
  it('tie-breaks on canonical STAR_KEYS order', () => {
    const next = pickNextStar([star('innovatore', null, 1, 2), star('creatore', null, 1, 2)]);
    expect(next?.starId).toBe('creatore'); // creatore precedes innovatore in STAR_KEYS
  });
  it('null when all earned or empty', () => {
    expect(pickNextStar([])).toBeNull();
    expect(pickNextStar([star('creatore', '2026-01-01', 2, 2)])).toBeNull();
  });

  // The tie-break test above happens to put the loser first, so `reduce` reaches the winner
  // through the `return b` path — the `return a` path was never taken, and a mutant that always
  // returns b passed. Same tie, opposite array order.
  it('tie-breaks on canonical order regardless of array order', () => {
    const next = pickNextStar([star('creatore', null, 1, 2), star('innovatore', null, 1, 2)]);
    expect(next?.starId).toBe('creatore');
  });

  // Likewise, every ratio comparison above had the better star first, so the "b is strictly
  // better" branch never fired.
  it('picks the better ratio when it comes second in the array', () => {
    const next = pickNextStar([star('mentor', null, 1, 3), star('creatore', null, 1, 2)]);
    expect(next?.starId).toBe('creatore');
  });

  // A zero `total` would make the ratio NaN, and NaN loses every comparison — the star would
  // then win or lose by array position instead of by progress. `visionario` is first in
  // STAR_KEYS, so if the guard were dropped the tie-break would hand it the pick.
  it('a star with no total ranks below real progress rather than poisoning the compare', () => {
    const next = pickNextStar([star('visionario', null, 0, 0), star('creatore', null, 1, 2)]);
    expect(next?.starId).toBe('creatore');
  });
});

const NOW = new Date('2026-06-17T12:00:00.000Z');
// `summarizeWeek` takes the same Pick<> its signature declares — typed here rather than
// cast, so a rename of an AuraEvent field breaks the fixture instead of silently passing.
const ev = (
  type: AuraEventType,
  points: number,
  iso: string,
): Pick<AuraEvent, 'type' | 'points' | 'createdAt'> => ({ type, points, createdAt: iso });

describe('summarizeWeek', () => {
  it('sums positive points and counts in the 7-day window', () => {
    const r = summarizeWeek(
      [
        ev('own_milestone', 10, '2026-06-17T08:00:00Z'),
        ev('milestone_help', 40, '2026-06-16T08:00:00Z'),
        ev('decay', -3, '2026-06-16T02:00:00Z'), // negative → excluded from auraWeek/contributi
        ev('post_starred', 2, '2026-06-01T08:00:00Z'), // older than 7d → excluded
      ],
      NOW,
    );
    expect(r.auraWeek).toBe(50);
    expect(r.contributi).toBe(2);
    expect(r.sogniAiutati).toBe(1);
    expect(r.oreDonate).toBe(0);
  });
  it('streak counts consecutive days ending today, capped at 7', () => {
    const days = ['17', '16', '15'].map((d) => ev('own_milestone', 10, `2026-06-${d}T09:00:00Z`));
    expect(summarizeWeek(days, NOW).streakDays).toBe(3);
  });
  it('no event today → streak 0', () => {
    expect(summarizeWeek([ev('own_milestone', 10, '2026-06-15T09:00:00Z')], NOW).streakDays).toBe(
      0,
    );
  });
  it('empty ledger → all zero', () => {
    expect(summarizeWeek([], NOW)).toEqual({
      auraWeek: 0,
      contributi: 0,
      sogniAiutati: 0,
      oreDonate: 0,
      streakDays: 0,
    });
  });

  // The window is inclusive at both ends and the suite only ever tested points well inside it,
  // so shrinking either bound to a strict comparison passed. windowStart is exactly NOW − 7d.
  it('includes an event landing exactly on the window start', () => {
    const r = summarizeWeek([ev('own_milestone', 10, '2026-06-10T12:00:00.000Z')], NOW);
    expect(r.auraWeek).toBe(10);
    expect(r.contributi).toBe(1);
  });
  it('includes an event landing exactly on now', () => {
    const r = summarizeWeek([ev('own_milestone', 10, '2026-06-17T12:00:00.000Z')], NOW);
    expect(r.auraWeek).toBe(10);
    expect(r.contributi).toBe(1);
  });
  // A ledger row stamped in the future is out of the window on the upper side. Nothing tested
  // that side at all, so dropping the `at <= now` bound was invisible.
  it('excludes an event stamped after now', () => {
    const r = summarizeWeek([ev('own_milestone', 10, '2026-06-18T09:00:00Z')], NOW);
    expect(r.auraWeek).toBe(0);
    expect(r.contributi).toBe(0);
  });

  // A zero-point row is not a contribution and must not keep a streak alive. The suite had a
  // negative row (decay) but never a zero, so `> 0` and `>= 0` were indistinguishable.
  it('a zero-point row neither counts as a contribution nor sustains the streak', () => {
    const r = summarizeWeek(
      [
        ev('own_milestone', 10, '2026-06-17T09:00:00Z'),
        ev('post_starred', 0, '2026-06-16T09:00:00Z'),
        ev('own_milestone', 10, '2026-06-15T09:00:00Z'),
      ],
      NOW,
    );
    expect(r.auraWeek).toBe(20);
    expect(r.contributi).toBe(2);
    expect(r.streakDays).toBe(1); // stops at the zero-point day, does not reach the 15th
  });

  // The cap in the title of the streak test above was never actually exercised — three days
  // cannot reveal a loop that runs one iteration too far.
  it('caps the streak at 7 even on an unbroken 8-day run', () => {
    const days = ['17', '16', '15', '14', '13', '12', '11', '10'].map((d) =>
      ev('own_milestone', 10, `2026-06-${d}T09:00:00Z`),
    );
    expect(summarizeWeek(days, NOW).streakDays).toBe(7);
  });
});
