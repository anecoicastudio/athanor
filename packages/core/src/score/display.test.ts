import { describe, expect, it } from 'vitest';
import { breakdownRows, pickNextStar } from './display';

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
