import { describe, expect, it } from 'vitest';
import { derivePostType } from './post-type';

describe('derivePostType', () => {
  it('is text when no media', () => expect(derivePostType([])).toBe('text'));
  it('is image for images only', () => expect(derivePostType(['image', 'image'])).toBe('image'));
  it('prefers video over audio over image', () => {
    expect(derivePostType(['image', 'audio', 'video'])).toBe('video');
    expect(derivePostType(['image', 'audio'])).toBe('audio');
  });
});
