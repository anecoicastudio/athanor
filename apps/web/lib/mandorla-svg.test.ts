import { describe, expect, it } from 'vitest';
import { gradient, semantic } from '@athanor/config';
import { mandorlaDataUri } from './mandorla-svg';

/** The SVG back out of the data URI, so assertions read against markup rather than escapes. */
const svg = (stroke?: number) =>
  decodeURIComponent(
    (stroke === undefined ? mandorlaDataUri() : mandorlaDataUri(stroke)).replace(
      'data:image/svg+xml,',
      '',
    ),
  );

describe('mandorlaDataUri', () => {
  it('emits a decodable svg data URI', () => {
    const uri = mandorlaDataUri();
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    // Percent-encoded, not raw: an unencoded `#` would truncate the URI at the first colour.
    expect(uri).not.toContain('<svg');
    expect(svg()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg()).toContain('</svg>');
  });

  // Rule #4. This file exists BECAUSE Satori renders an isolated tree with no CSS tokens, which
  // is exactly the situation where someone reaches for a literal hex. The tokens are the
  // assertion, not the colour values — pinning the hex here would defeat the point.
  it('takes every colour from @athanor/config, never a literal', () => {
    const out = svg();
    expect(out).toContain(gradient[1]);
    expect(out).toContain(gradient[2]);
    expect(out).toContain(gradient[3]);
    expect(out).toContain(semantic.aura);
  });

  it('contains no hex that is not one of those four tokens', () => {
    const allowed = new Set(
      [gradient[1], gradient[2], gradient[3], semantic.aura].map((c) => c.toLowerCase()),
    );
    const hexes = svg().match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    // The `id="g"` gradient reference is `url(#g)`, not a hex, so anything matched here is a
    // colour — and every one of them must have come from the token set.
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(allowed).toContain(hex.toLowerCase());
  });

  it('draws the mandorla as two overlapping vesica circles plus the kairos star', () => {
    const out = svg();
    const circles = [...out.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)];
    expect(circles).toHaveLength(2);
    // The PROPERTY, not the coordinates: same radius and cy, different cx, and the centres
    // closer together than the diameter — that overlap IS the vesica (DESIGN §5). Pinning the
    // literals would fail a legitimate design tweak for no safety gain.
    const [a, b] = circles.map((m) => ({ cx: +m[1]!, cy: +m[2]!, r: +m[3]! }));
    expect(a!.r).toBe(b!.r);
    expect(a!.cy).toBe(b!.cy);
    expect(Math.abs(a!.cx - b!.cx)).toBeGreaterThan(0);
    expect(Math.abs(a!.cx - b!.cx)).toBeLessThan(2 * a!.r);
    expect(out).toContain(`fill="${semantic.aura}"`);
  });

  it('defaults the stroke to 4 and honours an override', () => {
    expect(svg()).toContain('stroke-width="4"');
    expect(svg(2)).toContain('stroke-width="2"');
    expect(svg(2)).not.toContain('stroke-width="4"');
  });

  it('applies the stroke to both circles, not just the first', () => {
    expect(svg(7).match(/stroke-width="7"/g)).toHaveLength(2);
  });

  it('paints the circles with the gradient and the star with a flat token', () => {
    // The mandala gradient is logo/hero only (rule #4) — it must never become a UI fill, and
    // the star must not inherit it.
    const out = svg();
    expect(out.match(/stroke="url\(#g\)"/g)).toHaveLength(2);
    expect(out).not.toContain(`fill="url(#g)"`);
  });
});
