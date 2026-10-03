import { describe, expect, it } from 'vitest';
import { localeTag } from './locale-tag';

describe('localeTag', () => {
  it('maps it to the Italian tag', () => {
    expect(localeTag('it')).toBe('it-IT');
  });

  // en-GB and NOT en-US: the two disagree on date order and clock (the last apps/web call
  // site that said en-US, the launch countdown, was removed 2026-10-03, #269). Pin the tag so a consolidation onto this
  // function can never quietly change what a reader sees.
  it('maps en to the British tag, not the American one', () => {
    expect(localeTag('en')).toBe('en-GB');
    expect(localeTag('en')).not.toBe('en-US');
  });
});
