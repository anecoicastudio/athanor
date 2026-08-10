import { describe, expect, it } from 'vitest';
import { STAR_KEYS, type StarKey } from '@athanor/schemas';
import { AURA_UNKNOWN } from './aura-display';
import { STAR, star, starCellState, starGlyph, starsBlockMode } from './star';

const row = (starId: StarKey, grantedAt: string | null) => ({ starId, grantedAt });

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

  it('takes its unknown mark from the Aura placeholder, so the two cannot drift apart', () => {
    expect(STAR.unknown).toBe(AURA_UNKNOWN);
    expect(STAR.unknown).toBe('—');
  });

  it('gives all three states distinct glyphs — unknown is a SHAPE, not a dimmer colour', () => {
    const glyphs = new Set([starGlyph('lit'), starGlyph('unlit'), starGlyph('unknown')]);
    expect(glyphs.size).toBe(3);
  });
});

describe('starCellState', () => {
  it('reads a granted row as lit and a granted-null row as unlit', () => {
    const stars = [row('visionario', '2026-08-01T00:00:00Z'), row('mentor', null)];
    expect(starCellState(stars, 'visionario')).toBe('lit');
    expect(starCellState(stars, 'mentor')).toBe('unlit');
  });

  it('treats a star with no row at all as unlit — the engine only writes rows it has touched', () => {
    expect(starCellState([], 'creatore')).toBe('unlit');
    expect(starCellState([row('mentor', null)], 'creatore')).toBe('unlit');
  });

  // THE bug (issue #16). These two inputs used to be indistinguishable because every call site
  // wrote `starsQuery.data ?? []`, so a failed read rendered as six confidently dark stars.
  it('separates «earned none» from «could not read» — the whole point of the null', () => {
    expect(starCellState([], 'visionario')).toBe('unlit');
    expect(starCellState(null, 'visionario')).toBe('unknown');
    expect(starCellState([], 'visionario')).not.toBe(starCellState(null, 'visionario'));
  });

  it('is unknown for every one of the six when the read failed, not just the rowless ones', () => {
    // Iterates STAR_KEYS rather than a hand-written list: a literal list silently loses a star
    // when one is added, and enumerating five of six is how `ambasciatore` went unasserted.
    expect(STAR_KEYS).toHaveLength(6);
    for (const key of STAR_KEYS) expect(starCellState(null, key)).toBe('unknown');
  });

  it('never lets a granted date leak past a null read', () => {
    // Guards the shape of the guard: an implementation that looked the row up FIRST and only
    // then checked for null would return 'lit' here, which is the false-confidence bug inverted.
    expect(starCellState(null, 'visionario')).toBe('unknown');
  });
});

describe('starsBlockMode — the rule #3 asymmetry', () => {
  it('renders the grid whenever the read landed, for either viewer', () => {
    expect(starsBlockMode([], true)).toBe('grid');
    expect(starsBlockMode([], false)).toBe('grid');
    expect(starsBlockMode([row('mentor', '2026-08-01T00:00:00Z')], false)).toBe('grid');
  });

  it('keeps the grid for the OWNER on a failed read — six unknown cells, no reflow', () => {
    expect(starsBlockMode(null, true)).toBe('grid');
  });

  // The branch that could leak. Six unknown cells on someone else's profile would render more
  // cells than a real profile with two lit stars, so the viewer's own network failure would show
  // up as a shape difference — a claim about a person, made out of the reader's connection.
  it('collapses to one placeholder for ANOTHER member on a failed read', () => {
    expect(starsBlockMode(null, false)).toBe('unavailable');
  });

  it('is the only input that produces the placeholder — an empty read is never unavailable', () => {
    const inputs: [Parameters<typeof starsBlockMode>[0], boolean][] = [
      [null, true],
      [null, false],
      [[], true],
      [[], false],
    ];
    const unavailable = inputs.filter(([s, owner]) => starsBlockMode(s, owner) === 'unavailable');
    expect(unavailable).toEqual([[null, false]]);
  });
});
