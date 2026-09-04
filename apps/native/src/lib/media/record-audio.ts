import {
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  type RecordingOptions,
  type RecordingStartOptions,
} from 'expo-audio';
import { MEDIA_LIMITS } from '@athanor/core';

/**
 * How the in-app voice recorder is configured (#154).
 *
 * `expo-audio`'s own `RecordingPresets` cannot be used, and the reason is a bucket rather than
 * a taste: `HIGH_QUALITY` declares `audio/webm` on web, and `LOW_QUALITY` writes `.3gp`
 * (`audio/3gpp`) on Android. Neither is in the `post-media` bucket's `allowed_mime_types`, so
 * either would upload the whole file and then 415 at the very end. Spelling the options out is
 * what keeps the recording's container and the bucket's allowlist the same set.
 *
 * Every value comes from `MEDIA_LIMITS` (rule #10) and the two iOS enums are indexed BY NAME,
 * the same discipline `pick.ts` applies to the picker's quality enums: the constant holds the
 * member name, so a renamed member is a type error here rather than an ordinal that quietly
 * starts meaning something else on one platform. `audio-recording.test.ts` pins all of it by
 * source audit, because `environment: 'node'` cannot drive a recorder.
 *
 * Mono at 64 kbps is a voice-note budget, not a music one: a full 60s take is around half a
 * megabyte against the bucket's 50 MiB object cap, which is why audio needs no byte limit of
 * its own the way video does.
 */
export const AUDIO_RECORDING_OPTIONS: RecordingOptions = {
  extension: MEDIA_LIMITS.AUDIO_EXTENSION,
  sampleRate: MEDIA_LIMITS.AUDIO_SAMPLE_RATE,
  numberOfChannels: MEDIA_LIMITS.AUDIO_CHANNELS,
  bitRate: MEDIA_LIMITS.AUDIO_BIT_RATE,
  android: {
    extension: MEDIA_LIMITS.AUDIO_EXTENSION,
    outputFormat: MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_ANDROID,
    audioEncoder: MEDIA_LIMITS.AUDIO_ENCODER_ANDROID,
  },
  ios: {
    extension: MEDIA_LIMITS.AUDIO_EXTENSION,
    outputFormat: IOSOutputFormat[MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_IOS],
    audioQuality: AudioQuality[MEDIA_LIMITS.AUDIO_QUALITY_IOS],
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  // Declared for completeness and deliberately NOT relied on: MediaRecorder gives a browser
  // webm in every engine that matters, which `resolveAudioContentType` then refuses by name.
  // Naming mp4 here means a browser that can honour it produces an uploadable file; one that
  // cannot produces a NAMED refusal instead of a 415 at publish.
  web: { mimeType: MEDIA_LIMITS.AUDIO_CONTENT_TYPE, bitsPerSecond: MEDIA_LIMITS.AUDIO_BIT_RATE },
};

/**
 * The native hard stop at the clip cap.
 *
 * `forDuration` is documented `@platform ios` / `@platform android` — there is no web
 * implementation — so it is a belt, not the whole braces: `AudioRecorderSheet` also watches
 * `durationMillis` through `reachedClipCap`. The native one matters because it survives a busy
 * JS thread, which is exactly when a watchdog would drift, and because it lands the recording
 * ON the boundary rather than a poll interval past it.
 */
export const AUDIO_RECORDING_START: RecordingStartOptions = {
  forDuration: MEDIA_LIMITS.MAX_CLIP_SECONDS,
};

/**
 * Put the audio session into recording mode.
 *
 * Not optional and not cosmetic on iOS: without `allowsRecording` the session category stays a
 * playback one, and a device with the ringer switch off records silence — a full-length file of
 * nothing, with no error raised anywhere for the member or for us. `playsInSilentMode` is the
 * same switch seen from the playback side, so a recording can be heard back where it was made.
 */
export async function enterRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

/**
 * Hand the audio session back to playback once the recorder is done with it.
 *
 * iOS keeps the recording category until something changes it, and a session left in it ducks
 * and re-routes ordinary playback — a story's video plays through the earpiece instead of the
 * speaker after a member records one voice note. Called on unmount as well as on stop, so
 * backing out of the sheet mid-take restores it too.
 */
export async function leaveRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
}
