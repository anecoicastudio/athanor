import { describe, expect, it } from 'vitest';
import {
  avatarPath,
  chatMediaPath,
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

  it('gives a recording the .m4a the bucket accepts, never the image default (#154)', () => {
    // This read `kind === 'video' ? 'mp4' : 'jpg'` while `PickedMedia.kind` had two members,
    // so widening the union to include audio would have written every recording to `0.jpg` —
    // an object whose key claims a JPEG, under a Content-Type of `audio/mp4`. The extension
    // is not cosmetic: `media-process` dispatches on the bytes, but a human reading the
    // bucket sees the key.
    expect(postMediaPath('u1', 'p1', 0, 'audio')).toBe('u1/p1/0.m4a');
    expect(postMediaPath('u1', 'p1', 2, 'audio')).toBe('u1/p1/2.m4a');
  });

  it('gives every kind a distinct key at the same position (#154)', () => {
    // Position is unique per post, so the extension is the only thing separating the three.
    const keys = (['image', 'video', 'audio'] as const).map((k) => postMediaPath('u', 'p', 0, k));
    expect(new Set(keys).size).toBe(3);
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

describe('the buckets that take no audio cannot be handed any (#154)', () => {
  // A TYPE claim, asserted as one: `momentPath` and `storyPath` take
  // `Exclude<PickedMedia['kind'], 'audio'>`, so `momentPath('u', 'm', 'audio')` does not
  // compile. That is the whole guard — `moments` and `story-segments` list no audio type in
  // allowed_mime_types (20260819163146), so an audio segment is a 415, and the compiler is a
  // better place to learn that than a failed upload. The runtime assertions below only pin
  // that the two kinds they DO accept still round-trip; the refusal itself is checked by
  // `pnpm typecheck`, which is why the negative case is written as a comment and not a cast.
  it('still builds the two kinds those buckets do accept', () => {
    expect(momentPath('u1', 'm1', 'image')).toBe('u1/m1.jpg');
    expect(storyPath('u1', 's1', 'video')).toBe('u1/s1.mp4');
  });
});

describe('chatMediaPath', () => {
  it('builds `${uid}/${conversationId}/${mediaId}.jpg` — uid first, conversation second (#155)', () => {
    // Segment order is what the policies key on: [1] = owner (owner-write, not_blocked read
    // predicate), [2] = conversation (participant-read, and the messages insert policy's
    // `media_url like sender/conversation/%` pin). Swapped segments would be refused on write
    // and unreadable on read.
    expect(chatMediaPath('u1', 'c1', 'm1')).toBe('u1/c1/m1.jpg');
  });

  it('is always .jpg — chat attaches images only, re-encoded by processImage', () => {
    expect(chatMediaPath('u1', 'c1', 'm1').endsWith('.jpg')).toBe(true);
  });
});
