import { describe, expect, it } from 'vitest';
import { STAR, star } from './star';

describe('star', () => {
  it('gives the two states different glyphs — shape carries the state', () => {
    expect(star(true)).toBe(STAR.lit);
    expect(star(false)).toBe(STAR.unlit);
    expect(star(true)).not.toBe(star(false));
  });

  it('never returns an empty glyph', () => {
    expect(star(true)).toBeTruthy();
    expect(star(false)).toBeTruthy();
  });

  it('pins the actual characters — a silent swap would flip every star in the app', () => {
    expect(STAR.lit).toBe('✦');
    expect(STAR.unlit).toBe('✧');
  });
});
