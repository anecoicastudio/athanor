import { describe, expect, it, vi } from 'vitest';
import { firstFreeHandle } from './handle-suggestion';

/**
 * #908 (2026-10-01): the onboarding handle step offers a handle built from the name the person
 * already gave. Core proposes the shapes (`suggestHandles`); which of them is FREE is the
 * database's to say, and this walks them in order until one is.
 */
describe('firstFreeHandle', () => {
  it('offers the first candidate when it is free, and asks about nothing else', async () => {
    const isTaken = vi.fn().mockResolvedValue(false);
    await expect(firstFreeHandle(['elena_rossi', 'elenarossi'], isTaken)).resolves.toBe(
      'elena_rossi',
    );
    expect(isTaken.mock.calls).toEqual([['elena_rossi']]);
  });

  it('skips a taken candidate and offers the next free one, in order', async () => {
    const taken = new Set(['elena_rossi', 'elenarossi']);
    const isTaken = vi.fn((handle: string) => Promise.resolve(taken.has(handle)));
    await expect(
      firstFreeHandle(['elena_rossi', 'elenarossi', 'elena_r', 'elena'], isTaken),
    ).resolves.toBe('elena_r');
    expect(isTaken.mock.calls).toEqual([['elena_rossi'], ['elenarossi'], ['elena_r']]);
  });

  it('offers nothing when every candidate is taken', async () => {
    await expect(firstFreeHandle(['luna'], () => Promise.resolve(true))).resolves.toBeNull();
  });

  it('offers nothing, and asks nothing, when there is no candidate', async () => {
    const isTaken = vi.fn();
    await expect(firstFreeHandle([], isTaken)).resolves.toBeNull();
    expect(isTaken).not.toHaveBeenCalled();
  });

  // A lookup that failed is not «free». Offering an unchecked handle as the one-tap default
  // would put a refusal behind the first button the person presses.
  it('offers nothing when a lookup fails — an unchecked handle is never the suggestion', async () => {
    const isTaken = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(firstFreeHandle(['elena_rossi', 'elenarossi'], isTaken)).resolves.toBeNull();
    expect(isTaken).toHaveBeenCalledTimes(1);
  });
});
