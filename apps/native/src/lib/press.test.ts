import { describe, expect, it } from 'vitest';
import { PRESS_DIM, pillPress } from './press';

describe('what a press looks like (DESIGN §10)', () => {
  it('a pill dims and scales when motion is allowed', () => {
    expect(pillPress(false).split(' ').sort()).toEqual([
      'active:opacity-60',
      'active:scale-[0.98]',
    ]);
  });

  it('under Reduce Motion a pill only dims: the scale is the motion, the dim is a cut', () => {
    expect(pillPress(true)).toBe('active:opacity-60');
  });

  it('the dim is one class, and a pill takes that same class in both states', () => {
    expect(PRESS_DIM).toBe('active:opacity-60');
    expect(pillPress(false).split(' ')).toContain(PRESS_DIM);
    expect(pillPress(true)).toBe(PRESS_DIM);
  });
});
