import type { PickedMedia } from './pick';

export type MediaBucket = 'post-media' | 'moments' | 'story-segments';

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

/** Storage key for a story segment: `${uid}/${segmentId}.{ext}`. */
export function storyPath(uid: string, segmentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${segmentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}
