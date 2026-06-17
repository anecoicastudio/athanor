import { describe, expect, it } from 'vitest';
import { breakdownRows, pickNextStar, summarizeWeek } from './display';

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
    expect(rows[0].width).toBeCloseTo(1); // contributi is the max (188)
    expect(rows[5].width).toBeCloseTo(30 / 188);
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
  starId: string,
  granted: string | null,
  done: number,
  total: number,
  unit = 'tappe',
) =>
  ({
    id: starId,
    profileId: 'p',
    starId,
    grantedAt: granted,
    progress: { done, total, unit },
  }) as any;

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
});

const NOW = new Date('2026-06-17T12:00:00.000Z');
const ev = (type: string, points: number, iso: string) => ({ type, points, createdAt: iso }) as any;

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
});
