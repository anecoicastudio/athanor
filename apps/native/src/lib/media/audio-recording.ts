import { MEDIA_LIMITS } from '@athanor/core';
import type { MessageKey } from '@athanor/i18n';
import { resolveAudioContentType, type PickedMedia } from './asset';

/**
 * Why a finished recording cannot become a post attachment (#154).
 *
 * A different set from `VideoRejection`, not a subset of it, because the two doors refuse for
 * different reasons. There is no `'too-long'` here: the recorder OWNS the cap — it stops
 * itself — so length is never the member's mistake to be told about (see {@link
 * recordedSeconds}). And there is no `'too-large'`: the bitrate is fixed in `MEDIA_LIMITS`
 * rather than chosen by a camera, so `MAX_CLIP_SECONDS` bounds the bytes and a byte check
 * would be a rule that can never fire.
 *
 * `'empty'` has no counterpart on the picker side at all. A picker either returns an asset or
 * reports a cancel; a recorder can hand back a session that produced nothing — `uri` is
 * `string | null` and a zero-length take is a double-tapped button.
 */
export type AudioRejection = 'unsupported-type' | 'empty';

/** A finished recording: an accepted descriptor, or a named refusal. */
export type AudioRecordingOutcome =
  | { outcome: 'picked'; media: PickedMedia }
  | { outcome: 'rejected'; reason: AudioRejection };

/**
 * The i18n key each refusal names itself with.
 *
 * A `Record<AudioRejection, …>` for the reason `REJECTION_MESSAGE` is one: a reason added to
 * the union without copy would not compile. Separate from `REJECTION_MESSAGE` rather than
 * spread from it, because the one reason they share by name does NOT share a sentence —
 * `media.unsupportedType` reads «Questo formato video non lo sappiamo leggere», which is true
 * of a video and a lie about a recording the member just made.
 */
export const AUDIO_REJECTION_MESSAGE: Record<AudioRejection, MessageKey> = {
  'unsupported-type': 'media.unsupportedAudio',
  empty: 'media.record.empty',
};

/**
 * The Content-Type a recording made on this platform can honestly declare, or `undefined` when
 * the platform picks its own container and does not say which.
 *
 * Takes `Platform.OS` as an argument rather than importing it, so the decision is a pure one
 * this suite can actually run — `environment: 'node'` cannot load react-native.
 *
 * iOS and Android honour `AUDIO_RECORDING_OPTIONS` exactly: MPEG-4/AAC into an `.m4a`, so
 * `audio/mp4` is a statement about the bytes. **Web does not.** `expo-audio`'s web recorder is
 * MediaRecorder, which chooses its own container — webm in every engine that matters — and
 * never surfaces which one it settled on. Declaring `audio/mp4` there would put webm bytes
 * under an mp4 label in `storage.objects.metadata`, which is precisely the mislabel #461 spent
 * a migration closing for video. Undefined instead, which `resolveAudioContentType` turns into
 * a refusal the member can read.
 *
 * An unknown platform gets `undefined` for the same reason and not as a fallback: a new RN
 * target would otherwise inherit «this is definitely mp4» from a line nobody revisited.
 */
export function audioContentTypeFor(platformOS: string): string | undefined {
  return platformOS === 'ios' || platformOS === 'android'
    ? MEDIA_LIMITS.AUDIO_CONTENT_TYPE
    : undefined;
}

/** The recorder's cap, in the milliseconds its status reports. */
const CAP_MS = MEDIA_LIMITS.MAX_CLIP_SECONDS * 1000;

/**
 * Whether a recording has run to the cap — the stop condition web needs.
 *
 * `record({ forDuration })` is iOS and Android only (`RecordingStartOptions` says so in as
 * many words), so on web nothing stops the recorder but us. Comparing `>=` rather than `>`
 * keeps the two platforms agreeing about where 60 seconds ends: the native stop fires AT the
 * boundary, and a watchdog waiting for strictly-greater would run a beat longer.
 */
export function reachedClipCap(durationMillis: number): boolean {
  return durationMillis >= CAP_MS;
}

/**
 * A recording's length in whole seconds, clamped into what `post_media.duration_s` accepts.
 *
 * CLAMPED, where the picker doors REJECT, and the asymmetry is the point. `toPickedMedia`
 * refuses an over-cap video because a member chose a file we never controlled; here the
 * recorder stopped the recording itself, so an overshoot is our own stop being a poll interval
 * late. Refusing a member's voice note because our timer was 400ms slow would be absurd — but
 * so would writing a `duration_s` the CHECK rejects, which is what an unclamped round would do
 * on any overshoot at all. The floor at 0 guards the other end: `durationMillis` comes from a
 * native poll, and the column is `int check (… between 0 and 60)`.
 */
export function recordedSeconds(durationMillis: number): number {
  if (!(durationMillis > 0)) return 0;
  return Math.min(Math.round(durationMillis / 1000), MEDIA_LIMITS.MAX_CLIP_SECONDS);
}

/**
 * A stopped recorder → the `PickedMedia` the rest of the pipeline consumes, or a named refusal.
 *
 * This is the ONLY door in the app that produces `kind: 'audio'`. `expo-image-picker` has no
 * audio media type, so there is no library or camera path that can make one — which is why the
 * container check lives here rather than being spread across several call sites.
 *
 * The container is RESOLVED, never asserted (#461's rule, applied to a second family): the
 * bucket filters on the declared header rather than on the bytes, so a container outside
 * `MEDIA_LIMITS.AUDIO_MIME_TYPES` is refused by name before a byte moves instead of being
 * relabelled into acceptance. In practice that arm is **web**: `expo-audio` records
 * `audio/webm` in a browser and no bucket lists it. Expo web is this repo's QA harness, so
 * that path is walked often and deserves a sentence rather than a 415 at publish.
 *
 * No `width`/`height`: audio has none, and they are left undefined rather than zeroed because
 * `aspectRatio()` divides on a zero height while treating undefined as «unknown, use 4/5».
 */
export function recordedAudio(recording: {
  uri: string | null;
  durationMillis: number;
  mimeType: string | undefined;
}): AudioRecordingOutcome {
  const duration_s = recordedSeconds(recording.durationMillis);
  // A recorder stopped before it prepared reports a null uri, and a double-tapped button
  // produces a real file of no length. Neither is a voice note; both used to be uploadable.
  if (!recording.uri || duration_s === 0) return { outcome: 'rejected', reason: 'empty' };

  const contentType = resolveAudioContentType(recording.mimeType);
  if (contentType === null) return { outcome: 'rejected', reason: 'unsupported-type' };

  return {
    outcome: 'picked',
    media: { kind: 'audio', uri: recording.uri, duration_s, mimeType: contentType },
  };
}
