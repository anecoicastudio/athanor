import { describe, expect, it } from 'vitest';
import { toPeekStatus, toStatus } from './permission-status';

describe('toStatus — verdict after a real OS prompt', () => {
  it('granted wins regardless of canAskAgain', () => {
    expect(toStatus({ granted: true, canAskAgain: true })).toBe('granted');
    expect(toStatus({ granted: true, canAskAgain: false })).toBe('granted');
  });

  it('declined but still askable → denied', () => {
    expect(toStatus({ granted: false, canAskAgain: true })).toBe('denied');
  });

  it("declined and the OS won't ask again → blocked", () => {
    expect(toStatus({ granted: false, canAskAgain: false })).toBe('blocked');
  });
});

describe('toPeekStatus — verdict from a read that never prompted', () => {
  it('granted wins regardless of canAskAgain', () => {
    expect(toPeekStatus({ granted: true, canAskAgain: true })).toBe('granted');
    expect(toPeekStatus({ granted: true, canAskAgain: false })).toBe('granted');
  });

  it('still askable → undetermined, so the primer offers «Consenti»', () => {
    expect(toPeekStatus({ granted: false, canAskAgain: true })).toBe('undetermined');
  });

  it('not askable → blocked, so the primer deep-links to Settings', () => {
    expect(toPeekStatus({ granted: false, canAskAgain: false })).toBe('blocked');
  });

  it('never reports denied — a peek cannot distinguish never-asked from declined-but-askable', () => {
    const inputs = [
      { granted: true, canAskAgain: true },
      { granted: true, canAskAgain: false },
      { granted: false, canAskAgain: true },
      { granted: false, canAskAgain: false },
    ];
    expect(inputs.map(toPeekStatus)).not.toContain('denied');
  });
});

describe('the two mappers diverge only on declined-but-askable', () => {
  it('same verdict everywhere else', () => {
    for (const res of [
      { granted: true, canAskAgain: true },
      { granted: true, canAskAgain: false },
      { granted: false, canAskAgain: false },
    ]) {
      expect(toPeekStatus(res)).toBe(toStatus(res));
    }
  });

  it('prompted says denied where a peek says undetermined', () => {
    const res = { granted: false, canAskAgain: true };
    expect(toStatus(res)).toBe('denied');
    expect(toPeekStatus(res)).toBe('undetermined');
  });
});
