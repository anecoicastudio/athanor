import { describe, expect, it } from 'vitest';
import {
  avatarPath,
  momentPath,
  momentThumbPath,
  postMediaPath,
  postMediaThumbPath,
  storyPath,
} from './paths';

describe('postMediaPath', () => {
  it('builds `${uid}/${postId}/${index}.{ext}` per kind', () => {
    expect(postMediaPath('u1', 'p1', 0, 'image')).toBe('u1/p1/0.jpg');
    expect(postMediaPath('u1', 'p1', 3, 'video')).toBe('u1/p1/3.mp4');
  });
});

describe('postMediaThumbPath', () => {
  it('builds `${uid}/${postId}/${index}-thumb.jpg`', () => {
    expect(postMediaThumbPath('u1', 'p1', 0)).toBe('u1/p1/0-thumb.jpg');
  });

  it('keeps the uid first so the storage owner predicate still matches', () => {
    // post-media_insert_own checks (storage.foldername(name))[1] = auth.uid(); a poster written
    // anywhere else is denied.
    expect(postMediaThumbPath('u1', 'p1', 0).split('/')[0]).toBe('u1');
  });

  it('never collides with the post media object it posters', () => {
    expect(postMediaThumbPath('u1', 'p1', 0)).not.toBe(postMediaPath('u1', 'p1', 0, 'video'));
    // An image row at the same position is `u1/p1/0.jpg` — the poster suffix keeps the two
    // apart even though both are JPEGs in the same folder.
    expect(postMediaThumbPath('u1', 'p1', 0)).not.toBe(postMediaPath('u1', 'p1', 0, 'image'));
  });
});

describe('momentPath', () => {
  it('builds `${uid}/${momentId}.{ext}` per kind', () => {
    expect(momentPath('u1', 'm1', 'image')).toBe('u1/m1.jpg');
    expect(momentPath('u1', 'm1', 'video')).toBe('u1/m1.mp4');
  });
});

describe('momentThumbPath', () => {
  it('builds `${uid}/${momentId}-thumb.jpg`', () => {
    expect(momentThumbPath('u1', 'm1')).toBe('u1/m1-thumb.jpg');
  });

  it('keeps the uid first so the storage owner predicate still matches', () => {
    // moments_insert_own checks (storage.foldername(name))[1] = auth.uid(); a poster written
    // anywhere else is denied.
    expect(momentThumbPath('u1', 'm1').split('/')[0]).toBe('u1');
  });

  it('never collides with the moment media object it posters', () => {
    expect(momentThumbPath('u1', 'm1')).not.toBe(momentPath('u1', 'm1', 'video'));
    // A photo moment is `u1/m1.jpg` — the poster suffix keeps the two apart even though both
    // are JPEGs in the same folder.
    expect(momentThumbPath('u1', 'm1')).not.toBe(momentPath('u1', 'm1', 'image'));
  });
});

describe('avatarPath', () => {
  it('builds `${uid}/${uid}.jpg` — the convention 20260811072211 documents', () => {
    expect(avatarPath('u1')).toBe('u1/u1.jpg');
  });

  it('keeps the uid first so avatars_insert_own still matches', () => {
    // Every avatars policy keys on (storage.foldername(name))[1] = auth.uid().
    expect(avatarPath('u1').split('/')[0]).toBe('u1');
  });

  it('is stable for a member, so replacing a photo overwrites rather than accumulating', () => {
    expect(avatarPath('u1')).toBe(avatarPath('u1'));
  });
});

describe('storyPath', () => {
  it('builds `${uid}/${segmentId}.{ext}` per kind', () => {
    expect(storyPath('u1', 's1', 'image')).toBe('u1/s1.jpg');
    expect(storyPath('u1', 's1', 'video')).toBe('u1/s1.mp4');
  });
});
