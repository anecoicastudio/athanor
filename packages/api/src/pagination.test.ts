import { describe, expect, it } from 'vitest';
import { keysetFilter, nextCursorOf } from './pagination';

describe('keysetFilter', () => {
  it('builds the descending disjunction (lt)', () => {
    expect(keysetFilter('created_at', 'id', '2026-08-01T00:00:00Z', 'abc', 'lt')).toBe(
      'created_at.lt.2026-08-01T00:00:00Z,and(created_at.eq.2026-08-01T00:00:00Z,id.lt.abc)',
    );
  });

  it('builds the ascending disjunction (gt)', () => {
    expect(keysetFilter('starts_at', 'id', '2026-08-01T00:00:00Z', 'abc', 'gt')).toBe(
      'starts_at.gt.2026-08-01T00:00:00Z,and(starts_at.eq.2026-08-01T00:00:00Z,id.gt.abc)',
    );
  });

  it('supports a non-id tiebreaker column', () => {
    expect(keysetFilter('created_at', 'candidacy_id', 'T', 'c1', 'lt')).toBe(
      'created_at.lt.T,and(created_at.eq.T,candidacy_id.lt.c1)',
    );
  });

  it('supports numeric first components', () => {
    expect(keysetFilter('rank', 'id', 0.5, 'x', 'lt')).toBe('rank.lt.0.5,and(rank.eq.0.5,id.lt.x)');
  });
});

describe('nextCursorOf', () => {
  const rows = [
    { created_at: 'a', id: '1' },
    { created_at: 'b', id: '2' },
  ];
  const toCursor = (r: { created_at: string; id: string }) => ({
    created_at: r.created_at,
    id: r.id,
  });

  it('returns the last row cursor on a full page', () => {
    expect(nextCursorOf(rows, 2, toCursor)).toEqual({ created_at: 'b', id: '2' });
  });

  it('returns null on a short page', () => {
    expect(nextCursorOf(rows, 3, toCursor)).toBeNull();
  });

  it('returns null on an empty page', () => {
    expect(nextCursorOf([], 20, toCursor)).toBeNull();
  });
});
