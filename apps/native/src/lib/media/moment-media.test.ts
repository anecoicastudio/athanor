import { describe, expect, it } from 'vitest';
import { momentPosterPath, momentSignPaths } from './moment-media';

const photo = { kind: 'photo' as const, media_path: 'u1/p1.jpg', thumb_path: null };
const posterless = { kind: 'video' as const, media_path: 'u1/v1.mp4', thumb_path: null };
const postered = { kind: 'video' as const, media_path: 'u1/v2.mp4', thumb_path: 'u1/v2-thumb.jpg' };

describe('momentPosterPath', () => {
  it('draws a photo from its own bytes', () => {
    expect(momentPosterPath(photo)).toBe('u1/p1.jpg');
  });

  it('draws a video from its poster when there is one', () => {
    expect(momentPosterPath(postered)).toBe('u1/v2-thumb.jpg');
  });

  it('refuses to draw a video from its own bytes', () => {
    // This is the bug in #131: `media_path` here is an mp4, and handing an mp4 to an image
    // renderer produces a blank tile — every video Momento looking like every other one.
    expect(momentPosterPath(posterless)).toBeNull();
  });

  it('prefers a poster even on a photo that somehow has one', () => {
    // Nothing writes this today, but the column is nullable on both kinds; if a poster exists
    // it is the smaller object and the one meant for a tile.
    expect(momentPosterPath({ ...photo, thumb_path: 'u1/p1-thumb.jpg' })).toBe('u1/p1-thumb.jpg');
  });
});

describe('momentSignPaths', () => {
  it('signs the media of every moment — the lightbox still plays the video itself', () => {
    expect(momentSignPaths([photo, posterless])).toEqual(['u1/p1.jpg', 'u1/v1.mp4']);
  });

  it('signs a poster in addition to its media, never instead of it', () => {
    // One signing round-trip has to cover both surfaces: the tile wants the poster, the
    // lightbox wants the mp4, and they share one `urls` map.
    expect(momentSignPaths([postered])).toEqual(['u1/v2.mp4', 'u1/v2-thumb.jpg']);
  });

  it('emits each path once when moments share one', () => {
    expect(momentSignPaths([photo, photo])).toEqual(['u1/p1.jpg']);
  });

  it('is empty for no moments, so the signing query stays disabled', () => {
    expect(momentSignPaths([])).toEqual([]);
  });
});
