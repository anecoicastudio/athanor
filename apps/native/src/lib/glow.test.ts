import { semantic } from '@athanor/config';
import { describe, expect, it } from 'vitest';
import { auraGlow } from './glow';

/** The aura token's channels, derived — so the token stays the single source (rule #4). */
const rgb = [1, 3, 5].map((i) => Number.parseInt(semantic.aura.slice(i, i + 2), 16)).join(',');

describe('auraGlow', () => {
  it('level 0 or below → no glow at all', () => {
    expect(auraGlow(0)).toEqual({});
    expect(auraGlow(-1)).toEqual({});
  });

  it('level 1 → full Foundation §3 recipe as a CSS box-shadow', () => {
    expect(auraGlow(1)).toEqual({ boxShadow: `0 0 24px rgba(${rgb},0.45)` });
  });

  it('scales radius and alpha linearly, and rounds the string clean', () => {
    expect(auraGlow(0.5)).toEqual({ boxShadow: `0 0 12px rgba(${rgb},0.225)` });
    // 24 * 0.3 is 7.199999999999999 in binary floating point — never let that reach the style.
    expect(auraGlow(0.3)).toEqual({ boxShadow: `0 0 7.2px rgba(${rgb},0.135)` });
  });

  it('emits NO elevation and no shadow* pair — the Android artifact this replaced', () => {
    // Android paints an `elevation` shadow BENEATH the view, from an outline that has lost the
    // border radius. Every surface a glow lands on is translucent (`aura-soft` is cyan at 10%),
    // so that shadow read straight through as a hard square rectangle inside the box. A CSS
    // box-shadow is clipped out of the border box, so there is nothing to bleed through.
    const glow: Record<string, unknown> = auraGlow(1);
    for (const absent of [
      'elevation',
      'shadowColor',
      'shadowOpacity',
      'shadowRadius',
      'shadowOffset',
    ]) {
      expect(glow).not.toHaveProperty(absent);
    }
  });

  it('is built from the aura token, never a literal hex', () => {
    expect(rgb.split(',')).toHaveLength(3);
    expect(auraGlow(1).boxShadow).toContain(`rgba(${rgb},`);
    expect(auraGlow(1).boxShadow).not.toContain('#');
  });
});
