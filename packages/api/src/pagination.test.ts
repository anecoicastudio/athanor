import { describe, expect, it } from 'vitest';
import { decodeCursor, keysetFilter, nextCursorOf, probePage, tailCursor } from './pagination';

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

describe('decodeCursor', () => {
  it('splits a server-issued cursor into its two halves', () => {
    expect(decodeCursor('2026-08-01T10:00:00Z|abc', 'report')).toEqual({
      ts: '2026-08-01T10:00:00Z',
      id: 'abc',
    });
  });

  it('refuses a half cursor, naming the reader, rather than restarting at page one', () => {
    expect(() => decodeCursor('garbage', 'report')).toThrow('malformed report cursor: garbage');
    expect(() => decodeCursor('2026-08-01T10:00:00Z|', 'fund edition')).toThrow(
      /malformed fund edition cursor/,
    );
    expect(() => decodeCursor('|abc', 'waitlist')).toThrow(/malformed waitlist cursor/);
  });
});

describe('probePage', () => {
  it('drops the probe row and reports more when limit + 1 rows came back', () => {
    expect(probePage([1, 2, 3], 2)).toEqual({ page: [1, 2], hasMore: true });
  });

  it('keeps a short page whole and reports no more', () => {
    expect(probePage([1, 2], 2)).toEqual({ page: [1, 2], hasMore: false });
    expect(probePage([], 2)).toEqual({ page: [], hasMore: false });
  });
});

describe('tailCursor', () => {
  const rows = [
    { created_at: '2026-08-01T10:00:00Z', id: 'a' },
    { created_at: '2026-07-01T10:00:00Z', id: 'b' },
  ];

  it('encodes the LAST row of the page when there is more', () => {
    expect(tailCursor(rows, true)).toBe('2026-07-01T10:00:00Z|b');
  });

  it('is null when the probe saw nothing further, or the page is empty', () => {
    expect(tailCursor(rows, false)).toBeNull();
    expect(tailCursor([], true)).toBeNull();
  });

  it('is null when the tail row lacks a string half — no "load more" into a page that cannot exist', () => {
    // The old admin_list_waitlist shape, still answering while production lags the migration.
    expect(tailCursor([{ created_at: '2026-08-01T10:00:00Z' }], true)).toBeNull();
    expect(tailCursor([{ created_at: '2026-08-01T10:00:00Z', id: 7 }], true)).toBeNull();
    expect(tailCursor([null], true)).toBeNull();
  });
});
