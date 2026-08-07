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

/** Storage key for a story segment: `${uid}/${segmentId}.{ext}`. */
export function storyPath(uid: string, segmentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${segmentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}
