import type { MediaBucketName } from '@athanor/api';
import type { PickedMedia, VisualMediaKind } from './pick';

// Alias, not a second list: `@athanor/api` owns the bucket union, so a bucket added there
// reaches every native call site without a hand-edit here staying in step.
export type MediaBucket = MediaBucketName;

export type UploadTarget = { bucket: MediaBucket; path: string };

/**
 * The file extension each picked kind is written under.
 *
 * A total map rather than the `kind === 'video' ? 'mp4' : 'jpg'` ternary this replaced (#154).
 * That ternary was correct for exactly as long as the union had two members: widening it to
 * include audio made `'jpg'` the silent default for a recording, so every voice note would
 * have landed at `${index}.jpg` while declaring `audio/mp4` on the wire. A `Record` over the
 * union cannot acquire a member without acquiring an extension for it — the next kind will
 * not compile until somebody chooses.
 *
 * `.m4a` and not `.mp4`: the recording is MPEG-4/AAC with no video track, and `.m4a` is the
 * extension that says so. Both map to `audio/mp4` on the wire, which is what the bucket lists.
 */
const EXTENSION: Record<PickedMedia['kind'], string> = {
  image: 'jpg',
  video: 'mp4',
  audio: 'm4a',
};

/** Storage key for a post-media item: `${uid}/${postId}/${index}.{ext}`. */
export function postMediaPath(
  uid: string,
  postId: string,
  index: number,
  kind: PickedMedia['kind'],
): string {
  return `${uid}/${postId}/${index}.${EXTENSION[kind]}`;
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

/** Storage key for a moment: `${uid}/${momentId}.{ext}`. The `moments` bucket takes no audio. */
export function momentPath(uid: string, momentId: string, kind: VisualMediaKind): string {
  return `${uid}/${momentId}.${EXTENSION[kind]}`;
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

/** Storage key for a story segment. `story-segments` takes no audio either. */
export function storyPath(uid: string, segmentId: string, kind: VisualMediaKind): string {
  return `${uid}/${segmentId}.${EXTENSION[kind]}`;
}

/**
 * Storage key for a chat image: `${uid}/${conversationId}/${mediaId}.jpg` (#155).
 *
 * Two uuid segments, and BOTH are load-bearing: the first is the owner uid (what the
 * chat-media owner-write policies and the not_blocked/not_banned read predicates key on), the
 * second the conversation (what the participant-read policy and the messages insert policy's
 * prefix pin key on). Always `.jpg` — chat attaches images only, and `processImage` re-encodes
 * every pick to JPEG for the client-side EXIF strip, so no other extension survives to here.
 */
export function chatMediaPath(uid: string, conversationId: string, mediaId: string): string {
  return `${uid}/${conversationId}/${mediaId}.jpg`;
}
