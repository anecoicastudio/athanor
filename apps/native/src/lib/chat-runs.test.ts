import { describe, expect, it } from 'vitest';
import { isRunEnd, type RunRow } from './chat-runs';

const msg = (sender: string): RunRow => ({ type: 'msg', message: { sender_id: sender } });
const marker: RunRow = { type: 'marker' };

describe('isRunEnd', () => {
  it('ends the run on the last message before a different sender', () => {
    const rows = [msg('a'), msg('a'), msg('b')];
    expect(isRunEnd(rows, 0)).toBe(false);
    expect(isRunEnd(rows, 1)).toBe(true);
    expect(isRunEnd(rows, 2)).toBe(true);
  });

  it('ends the run at the end of the thread', () => {
    expect(isRunEnd([msg('a')], 0)).toBe(true);
  });

  it('ends the run at a day marker, even when the same person resumes after it', () => {
    // Otherwise the face floats above the date line and reads as a reply to the date.
    const rows = [msg('a'), marker, msg('a')];
    expect(isRunEnd(rows, 0)).toBe(true);
    expect(isRunEnd(rows, 2)).toBe(true);
  });

  it('is false for a marker row — a marker has no face to draw', () => {
    expect(isRunEnd([marker, msg('a')], 0)).toBe(false);
  });

  it('is false past the end of the list rather than throwing', () => {
    expect(isRunEnd([msg('a')], 7)).toBe(false);
    expect(isRunEnd([], 0)).toBe(false);
  });

  it('treats a null sender as its own run — a system message never groups with a person', () => {
    const rows = [{ type: 'msg', message: { sender_id: null } } as RunRow, msg('a')];
    expect(isRunEnd(rows, 0)).toBe(true);
  });
});
