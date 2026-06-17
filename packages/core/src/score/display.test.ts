import { describe, expect, it } from 'vitest';
import { breakdownRows } from './display';

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
