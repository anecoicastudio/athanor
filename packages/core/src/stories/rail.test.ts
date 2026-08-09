import { describe, expect, it } from 'vitest';
import { buildStoryRail, type StoryRailRow } from './rail';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

const row = (author: string, at: string, profiles: StoryRailRow['profiles']): StoryRailRow => ({
  author_id: author,
  created_at: at,
  profiles,
});

describe('buildStoryRail', () => {
  it('gives one entry per author, keeping their most recent activity time', () => {
    const rail = buildStoryRail(
      [
        row(AUTHOR, '2026-01-03T00:00:00Z', { handle: 'sole' }),
        row(AUTHOR, '2026-01-02T00:00:00Z', { handle: 'sole' }),
        row(OTHER, '2026-01-01T00:00:00Z', { handle: 'luna' }),
      ],
      50,
    );

    expect(rail).toEqual([
      { author_id: AUTHOR, handle: 'sole', latest_at: '2026-01-03T00:00:00Z' },
      { author_id: OTHER, handle: 'luna', latest_at: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('preserves the order the rows arrive in — the query, not this function, sorts', () => {
    const rail = buildStoryRail(
      [
        row(OTHER, '2026-01-01T00:00:00Z', { handle: 'luna' }),
        row(AUTHOR, '2026-01-09T00:00:00Z', { handle: 'sole' }),
      ],
      50,
    );
    expect(rail.map((p) => p.author_id)).toEqual([OTHER, AUTHOR]);
  });

  it('reads the embedded profile whether it arrives as a row, a list, or nothing', () => {
    const rail = buildStoryRail(
      [
        row(AUTHOR, '2026-01-03T00:00:00Z', null),
        row(OTHER, '2026-01-02T00:00:00Z', [{ handle: 'luna' }]),
        row(THIRD, '2026-01-01T00:00:00Z', { handle: 'stella' }),
      ],
      50,
    );
    expect(rail.map((p) => p.handle)).toEqual([null, 'luna', 'stella']);
  });

  it('treats an empty embedded list and a null handle alike — no handle', () => {
    const rail = buildStoryRail(
      [
        row(AUTHOR, '2026-01-03T00:00:00Z', []),
        row(OTHER, '2026-01-02T00:00:00Z', { handle: null }),
      ],
      50,
    );
    expect(rail.map((p) => p.handle)).toEqual([null, null]);
  });

  it('caps the rail at the requested number of PEOPLE, not rows', () => {
    const rail = buildStoryRail(
      [
        row(AUTHOR, '2026-01-05T00:00:00Z', { handle: 'sole' }),
        row(AUTHOR, '2026-01-04T00:00:00Z', { handle: 'sole' }),
        row(OTHER, '2026-01-03T00:00:00Z', { handle: 'luna' }),
        row(THIRD, '2026-01-02T00:00:00Z', { handle: 'stella' }),
      ],
      2,
    );
    expect(rail.map((p) => p.author_id)).toEqual([AUTHOR, OTHER]);
  });

  it('returns nothing for a non-positive cap rather than the whole window', () => {
    const rows = [row(AUTHOR, '2026-01-03T00:00:00Z', { handle: 'sole' })];
    expect(buildStoryRail(rows, 0)).toEqual([]);
    expect(buildStoryRail(rows, -1)).toEqual([]);
  });

  it('an empty window is an empty rail', () => {
    expect(buildStoryRail([], 50)).toEqual([]);
  });

  it('does not mutate the rows it is given', () => {
    const rows = [row(AUTHOR, '2026-01-03T00:00:00Z', { handle: 'sole' })];
    const snapshot = JSON.stringify(rows);
    buildStoryRail(rows, 1);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});
