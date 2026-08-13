import type { PickedMedia } from './pick';

export type MediaBucket =
  | 'post-media'
  | 'moments'
  | 'story-segments'
  | 'avatars'
  | 'candidacy-videos';

export type UploadTarget = { bucket: MediaBucket; path: string };

/** Storage key for a post-media item: `${uid}/${postId}/${index}.{ext}`. */
export function postMediaPath(
  uid: string,
  postId: string,
  index: number,
  kind: PickedMedia['kind'],
): string {
  return `${uid}/${postId}/${index}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

/**
 * Storage key for a post video's poster: `${uid}/${postId}/${index}-thumb.jpg`.
 *
 * Same `{uid}/…` folder as the mp4 it posters, because the post-media storage policies key on
 * the first path segment (owner-write), and `media_process_enqueue` strips whatever lands in the
 * bucket. The `-thumb` suffix keeps it clear of an image row's own `${index}.jpg` — position is
 * unique per post, but the suffix says what the object is (same convention as `momentThumbPath`
 * and `candidacyThumbPath`).
 */
export function postMediaThumbPath(uid: string, postId: string, index: number): string {
  return `${uid}/${postId}/${index}-thumb.jpg`;
}

/** Storage key for a moment: `${uid}/${momentId}.{ext}`. */
export function momentPath(uid: string, momentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${momentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

/**
 * Storage key for a moment's video poster: `${uid}/${momentId}-thumb.jpg`.
 *
 * Same folder as the moment it posters, because the uid-first segment is what every
 * `moments` storage policy keys on — owner insert/update/delete and the members-read
 * `not_blocked` predicate all read `(storage.foldername(name))[1]`. A poster written
 * anywhere else would be denied on write and unreadable on read.
 *
 * The `-thumb` suffix rather than a bare `.jpg` extension: a *photo* moment already owns
 * `${uid}/${momentId}.jpg`, so the extension alone does not separate the two.
 */
export function momentThumbPath(uid: string, momentId: string): string {
  return `${uid}/${momentId}-thumb.jpg`;
}

/**
 * Storage key for a member's avatar: `${uid}/${uid}.jpg` (#75's convention, and the seed
 * computes the same key in SQL).
 *
 * Deterministic on purpose — a profile's entity id IS its uid, so there is no second id to
 * hang a fresh key on. The cost is that replacing a photo reuses the key, so a client image
 * cache can serve the previous bytes until the signed URL it was fetched with expires; the
 * uploader busts that by re-signing (`useAvatarUpload`).
 *
 * Always `.jpg`: `processImage` re-encodes every picked image to JPEG for the EXIF strip, so
 * the source extension never survives to reach this.
 */
export function avatarPath(uid: string): string {
  return `${uid}/${uid}.jpg`;
}

/** Storage key for a story segment: `${uid}/${segmentId}.{ext}`. */
export function storyPath(uid: string, segmentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${segmentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}
