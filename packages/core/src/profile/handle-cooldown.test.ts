import { describe, expect, test } from 'vitest';
import {
  HANDLE_RENAME_COOLDOWN_DAYS,
  canRenameHandle,
  handleRenameOpensAt,
} from './handle-cooldown';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * #782 ruling: a member may rename their @handle once every 30 days. The database is the
 * enforcer (`profiles_handle_cooldown`, which refuses while now() < handle_changed_at + 30 days);
 * this is how the app knows the same date BEFORE it asks, so the edit form can say «puoi
 * cambiarlo di nuovo il …» instead of offering a field the server will refuse.
 */
describe('HANDLE_RENAME_COOLDOWN_DAYS', () => {
  test('is thirty — the ruled window', () => {
    expect(HANDLE_RENAME_COOLDOWN_DAYS).toBe(30);
  });
});

describe('handleRenameOpensAt', () => {
  test('null when the handle has never been renamed — the first choice starts no clock', () => {
    expect(handleRenameOpensAt(null)).toBeNull();
  });

  test('exactly thirty days after the last rename', () => {
    expect(handleRenameOpensAt('2026-09-19T10:00:00.000Z')?.toISOString()).toBe(
      '2026-10-19T10:00:00.000Z',
    );
  });

  test('reads a Postgres-style offset timestamp as the same instant', () => {
    expect(handleRenameOpensAt('2026-09-19T12:00:00+02:00')?.toISOString()).toBe(
      '2026-10-19T10:00:00.000Z',
    );
  });

  test('counts elapsed time, not calendar days across a DST change (the server runs in UTC)', () => {
    // 2026-10-25 is the EU clock change: thirty UTC days are 720 hours whatever the wall clock does.
    const opens = handleRenameOpensAt('2026-10-01T00:00:00.000Z');
    expect(opens?.getTime()).toBe(Date.parse('2026-10-01T00:00:00.000Z') + 30 * DAY_MS);
  });
});

describe('canRenameHandle', () => {
  const changedAt = '2026-09-19T10:00:00.000Z';
  const opens = Date.parse(changedAt) + 30 * DAY_MS;

  test('true when the handle has never been renamed', () => {
    expect(canRenameHandle(null, new Date(changedAt))).toBe(true);
  });

  test('false right after a rename', () => {
    expect(canRenameHandle(changedAt, new Date(changedAt))).toBe(false);
  });

  test('false one millisecond before the window closes — the server refuses there too', () => {
    expect(canRenameHandle(changedAt, new Date(opens - 1))).toBe(false);
  });

  test('true at the exact instant the window closes — the server accepts at +30 days', () => {
    expect(canRenameHandle(changedAt, new Date(opens))).toBe(true);
  });

  test('true after the window', () => {
    expect(canRenameHandle(changedAt, new Date(opens + DAY_MS))).toBe(true);
  });
});
