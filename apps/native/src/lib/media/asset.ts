import type { ImagePickerAsset } from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';
import type { MessageKey } from '@athanor/i18n';

/**
 * A single picked asset, normalized into the shape the rest of the media
 * pipeline consumes. `duration_s` is seconds (the picker returns ms).
 */
export type PickedMedia = {
  kind: 'image' | 'video';
  uri: string;
  width?: number;
  height?: number;
  duration_s?: number;
  mimeType?: string;
  /** File size in bytes, when the picker reported one. Undefined is «unknown», never zero. */
  bytes?: number;
};

/** Why a picked video cannot be uploaded. Mirrors the same members of `VideoFailure` (#412). */
export type VideoRejection = 'too-long' | 'too-large' | 'unsupported-type';

/**
 * What a candidacy video pick amounted to. A rejection carries its reason so the tile can name
 * it — the old shape was a bare `null`, indistinguishable from the member tapping Cancel.
 */
export type VideoPickOutcome =
  | { outcome: 'picked'; media: PickedMedia; contentType: string }
  | { outcome: 'rejected'; reason: VideoRejection };

/**
 * What a compose-flow pick amounted to (#507). Same two arms as {@link VideoPickOutcome} minus
 * the Content-Type, which only the candidacy upload declares.
 *
 * The `rejected` arm exists because the bare `null` this replaces was swallowed whole: an
 * over-cap video reached `MediaSheet` as the same value a Cancel produces, so the sheet closed
 * saying nothing at all. That silence is the defect — not, as #507's title reads, a wrong
 * sentence. There was no sentence.
 */
export type MediaPickOutcome =
  | { outcome: 'picked'; media: PickedMedia }
  | { outcome: 'rejected'; reason: VideoRejection };

/**
 * The i18n key each rejection names itself with.
 *
 * A `Record<VideoRejection, …>` rather than a switch so a new rejection cannot be added without
 * choosing its copy — the omission would not compile. It lives here, beside the type, and
 * `candidacy-video-status.ts` spreads it into its own wider `FAILURE_MESSAGE`: the three shared
 * reasons are therefore spelled once, and the two doors cannot drift into different sentences
 * for the same refusal.
 */
export const REJECTION_MESSAGE: Record<VideoRejection, MessageKey> = {
  'too-long': 'media.tooLong',
  'too-large': 'media.tooLarge',
  'unsupported-type': 'media.unsupportedType',
};

/** The picker asset → PickedMedia, with no acceptance rules applied. */
function normalize(asset: ImagePickerAsset): PickedMedia {
  const isVideo = asset.type === 'video';
  const kind: 'image' | 'video' = isVideo ? 'video' : 'image';
  const durationMs = asset.duration ?? null;
  const duration_s = durationMs != null ? Math.round(durationMs / 1000) : undefined;

  return {
    kind,
    uri: asset.uri,
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration_s,
    mimeType: asset.mimeType,
    bytes: asset.fileSize || undefined,
  };
}

/**
 * Map a picker asset → a named outcome for the `MediaSheet` compose flow.
 * `livePhoto`/`pairedVideo` are coerced to `image` (we never request them, but be defensive),
 * as is a rare Android ContentProvider `null` type.
 *
 * This used to be the LOSSY door: it answered `PickedMedia | null`, so a video over the 60s cap
 * was the same value as a Cancel and `MediaSheet` had nothing to branch on. That is why the
 * candidacy path went to {@link classifyVideoAsset} instead (#412) — and why the compose flow,
 * left behind, refused long videos in total silence until #507. Both doors now name their
 * refusals; the difference between them is which rules they apply, not what they can say.
 *
 * Only `'too-long'` is produced here, because duration is the only rule this door enforces: it
 * also accepts images, so the byte and container checks `classifyVideoAsset` makes have no
 * meaning for half its traffic. The reason is typed as the full {@link VideoRejection} anyway
 * so the two doors share one vocabulary, and so a rule added here later needs no call-site
 * change — {@link REJECTION_MESSAGE} already has copy for every member.
 */
export function toPickedMedia(asset: ImagePickerAsset): MediaPickOutcome {
  const media = normalize(asset);
  if (
    media.kind === 'video' &&
    media.duration_s != null &&
    media.duration_s > MEDIA_LIMITS.MAX_VIDEO_SECONDS
  ) {
    return { outcome: 'rejected', reason: 'too-long' };
  }
  return { outcome: 'picked', media };
}

/**
 * The Content-Type an upload should declare for a picked video, or `null` when the container
 * is one the bucket will refuse.
 *
 * A missing `mimeType` resolves to mp4 rather than to a rejection: the picker declining to
 * name a type is not evidence of a bad type, and mp4 is what this path declared unconditionally
 * before (#412). The difference is that a type the picker DOES name is now believed — a
 * QuickTime capture is labelled QuickTime, and `MEDIA_LIMITS.VIDEO_MIME_TYPES` (mirrored by the
 * bucket's `allowed_mime_types`) is what decides whether that label is acceptable.
 */
export function resolveVideoContentType(mimeType: string | undefined): string | null {
  if (!mimeType) return 'video/mp4';
  // A `type/subtype; codecs=…` parameter is legal and is not part of the allowlist comparison.
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed: readonly string[] = MEDIA_LIMITS.VIDEO_MIME_TYPES;
  return allowed.includes(normalized) ? normalized : null;
}

/**
 * Decide whether a picked asset can become a candidacy video, and under which Content-Type.
 *
 * Every rejection names a reason, because the bug this closes (#412) was that all of them were
 * one silent `null`. The order is the order a member would care about: the 60s cap is the rule
 * the screen advertises, the byte cap is the one that would otherwise cost minutes of upload
 * before failing, and the container check is last because it is the rarest.
 *
 * A non-video reaches here only if the picker returned one despite being launched videos-only;
 * it is rejected rather than uploaded, which is what `handle()` used to do silently.
 */
export function classifyVideoAsset(asset: ImagePickerAsset): VideoPickOutcome {
  const media = normalize(asset);
  if (media.kind !== 'video') return { outcome: 'rejected', reason: 'unsupported-type' };
  if (media.duration_s != null && media.duration_s > MEDIA_LIMITS.MAX_VIDEO_SECONDS) {
    return { outcome: 'rejected', reason: 'too-long' };
  }
  if (media.bytes != null && media.bytes > MEDIA_LIMITS.MAX_VIDEO_BYTES) {
    return { outcome: 'rejected', reason: 'too-large' };
  }
  const contentType = resolveVideoContentType(media.mimeType);
  if (contentType === null) return { outcome: 'rejected', reason: 'unsupported-type' };
  return { outcome: 'picked', media, contentType };
}
