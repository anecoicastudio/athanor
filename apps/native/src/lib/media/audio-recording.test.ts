import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from '@athanor/core';
import {
  AUDIO_REJECTION_MESSAGE,
  audioContentTypeFor,
  reachedClipCap,
  recordedAudio,
  recordedSeconds,
} from './audio-recording';

const CAP = MEDIA_LIMITS.MAX_CLIP_SECONDS;
const CAP_MS = CAP * 1000;

/** The accepted media, or undefined when the door refused. */
const accepted = (r: ReturnType<typeof recordedAudio>) =>
  r.outcome === 'picked' ? r.media : undefined;

describe('recordedSeconds — the recorder owns the cap, so it never reports past it', () => {
  it('converts milliseconds to whole seconds', () => {
    expect(recordedSeconds(0)).toBe(0);
    expect(recordedSeconds(1_000)).toBe(1);
    expect(recordedSeconds(12_400)).toBe(12);
  });

  it('rounds to the nearest second, like the picker path does', () => {
    expect(recordedSeconds(12_600)).toBe(13);
    expect(recordedSeconds(12_499)).toBe(12);
  });

  it('CLAMPS at the cap rather than reporting a value the CHECK would refuse', () => {
    // The difference between this and the picker doors, and it is deliberate. `toPickedMedia`
    // REJECTS an over-cap video because a member chose a file we never controlled. Here the
    // recorder stopped the recording itself — `forDuration` on device, a watchdog on web — so
    // an overshoot is our own timer being a few hundred milliseconds late, not a member
    // exceeding a limit. Refusing their recording for that would be absurd; the row simply
    // must not claim a duration `post_media_duration_s_check` would reject.
    expect(recordedSeconds(CAP_MS + 400)).toBe(CAP);
    expect(recordedSeconds(CAP_MS + 5_000)).toBe(CAP);
    expect(recordedSeconds(Number.MAX_SAFE_INTEGER)).toBe(CAP);
  });

  it('never reports a negative duration', () => {
    // `durationMillis` comes from a native poll; a reset mid-recording has produced negatives
    // in other RN audio libraries, and `duration_s` is `int check (… between 0 and 60)`.
    expect(recordedSeconds(-1)).toBe(0);
    expect(recordedSeconds(-100_000)).toBe(0);
  });
});

describe('reachedClipCap — the watchdog web needs, because forDuration is native-only', () => {
  it('is false below the cap', () => {
    expect(reachedClipCap(0)).toBe(false);
    expect(reachedClipCap(CAP_MS - 1)).toBe(false);
  });

  it('is true at and past the cap', () => {
    // At, not merely past: `record({ forDuration })` stops AT the boundary on iOS and Android,
    // and a web watchdog that waited for strictly-greater would let the two platforms disagree
    // about what 60 seconds means.
    expect(reachedClipCap(CAP_MS)).toBe(true);
    expect(reachedClipCap(CAP_MS + 1)).toBe(true);
  });
});

describe('recordedAudio — a finished recording becomes a PickedMedia, or names its refusal', () => {
  it('carries the uri, the audio kind and the clamped duration', () => {
    const media = accepted(
      recordedAudio({ uri: 'file:///tmp/rec.m4a', durationMillis: 8_200, mimeType: 'audio/mp4' }),
    );
    expect(media).toEqual({
      kind: 'audio',
      uri: 'file:///tmp/rec.m4a',
      duration_s: 8,
      mimeType: 'audio/mp4',
    });
  });

  it('is the ONE door that produces kind: audio', () => {
    // `expo-image-picker` has no audio door at all, so nothing else in the pipeline can make
    // one. If this stops saying 'audio' the composer silently uploads a recording as a photo.
    expect(
      accepted(recordedAudio({ uri: 'f', durationMillis: 3_000, mimeType: 'audio/mp4' }))?.kind,
    ).toBe('audio');
  });

  it('reports no dimensions — audio has none, and 0 would break aspectRatio()', () => {
    // `aspectRatio()` falls back to 4/5 on a nullish width/height but divides on a zero
    // height. Undefined is «this kind has no dimensions», which is what the column stores.
    const media = accepted(
      recordedAudio({ uri: 'f', durationMillis: 1_000, mimeType: 'audio/mp4' }),
    );
    expect(media?.width).toBeUndefined();
    expect(media?.height).toBeUndefined();
  });

  it('refuses a container the post-media bucket would 415 on, by name', () => {
    // Web records `audio/webm`. Expo web is this repo's QA harness, so this is the arm that
    // actually runs there — and it has to be a sentence, not an opaque failure at publish.
    const webm = recordedAudio({ uri: 'blob:x', durationMillis: 3_000, mimeType: 'audio/webm' });
    expect(webm).toEqual({ outcome: 'rejected', reason: 'unsupported-type' });
  });

  it('refuses a recording whose container the recorder could not name', () => {
    expect(recordedAudio({ uri: 'f', durationMillis: 3_000, mimeType: undefined })).toEqual({
      outcome: 'rejected',
      reason: 'unsupported-type',
    });
  });

  it('refuses a recording with no uri — there is nothing to upload', () => {
    // `AudioRecorder.uri` is `string | null`: a recorder stopped before it ever prepared
    // reports null, and a null threaded onward becomes an upload of the string "null".
    expect(recordedAudio({ uri: null, durationMillis: 3_000, mimeType: 'audio/mp4' })).toEqual({
      outcome: 'rejected',
      reason: 'empty',
    });
  });

  it('refuses a recording of no length — a tapped-twice button is not a voice note', () => {
    expect(
      recordedAudio({ uri: 'file:///tmp/rec.m4a', durationMillis: 0, mimeType: 'audio/mp4' }),
    ).toEqual({ outcome: 'rejected', reason: 'empty' });
  });

  it('accepts a recording that ran exactly to the cap', () => {
    // The `forDuration` stop lands here on every successful full-length recording, so this is
    // the common path and not an edge: it must not read as an overshoot.
    const media = accepted(
      recordedAudio({ uri: 'f', durationMillis: CAP_MS, mimeType: 'audio/mp4' }),
    );
    expect(media?.duration_s).toBe(CAP);
  });
});

describe('audioContentTypeFor — what the recorder can honestly claim it wrote', () => {
  it('names the configured container on the platforms that honour it', () => {
    // `AUDIO_RECORDING_OPTIONS` sets MPEG-4/AAC explicitly on both, so the file really is
    // `audio/mp4` and the header is a statement rather than a hope.
    expect(audioContentTypeFor('ios')).toBe(MEDIA_LIMITS.AUDIO_CONTENT_TYPE);
    expect(audioContentTypeFor('android')).toBe(MEDIA_LIMITS.AUDIO_CONTENT_TYPE);
  });

  it('claims nothing on web, where the browser picks the container and never tells us', () => {
    // MediaRecorder decides its own container — webm in every engine that matters — and
    // `expo-audio`'s web recorder does not surface which one it settled on. Undefined is the
    // honest answer, and `resolveAudioContentType` turns it into a named refusal rather than
    // an mp4 label over webm bytes, which is exactly the mislabel #461 closed for video.
    expect(audioContentTypeFor('web')).toBeUndefined();
  });

  it('claims nothing on a platform it has never been reasoned about on', () => {
    // Not a default: a new RN target would inherit whatever this returned, and inheriting
    // «it is definitely mp4» is how a mislabel ships. Refuse, and let somebody decide.
    expect(audioContentTypeFor('windows')).toBeUndefined();
    expect(audioContentTypeFor('macos')).toBeUndefined();
  });
});

describe('AUDIO_REJECTION_MESSAGE — every refusal names itself', () => {
  it('never sends an audio refusal to the video sentence', () => {
    // `media.unsupportedType` reads «Questo formato video non lo sappiamo leggere. Prova con
    // un altro video.» — true of a video and a lie about a recording the member just made.
    expect(AUDIO_REJECTION_MESSAGE['unsupported-type']).toBe('media.unsupportedAudio');
    expect(Object.values(AUDIO_REJECTION_MESSAGE)).not.toContain('media.unsupportedType');
  });

  it('tells a member who recorded nothing what happened, not that an upload failed', () => {
    // `media.failed` reads «Caricamento non riuscito» — a claim about an upload that never
    // started. A zero-length take is a double-tapped button, and the sentence that helps is
    // the one that says so.
    expect(AUDIO_REJECTION_MESSAGE.empty).toBe('media.record.empty');
  });

  it('maps every reason to its own key, never collapsing to media.failed', () => {
    const keys = Object.values(AUDIO_REJECTION_MESSAGE);
    expect(keys).not.toContain('media.failed');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(Object.keys(AUDIO_REJECTION_MESSAGE).length);
  });
});

/**
 * Source audit, the `pick.test.ts` idiom: `environment: 'node'` cannot drive a recorder, and
 * `record-audio.ts` imports `expo-audio` at the top level, so the options that must reach the
 * native recorder are pinned by reading the source.
 *
 * The defect these guard against is the one `expo-audio`'s own presets would hand us:
 * `RecordingPresets.HIGH_QUALITY` declares `audio/webm` on web and `LOW_QUALITY` writes `.3gp`
 * on Android, neither of which any bucket accepts. Nothing observable in JS fails when a
 * preset is used instead — the upload just 415s at the end.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url).href);
const source = readFileSync(`${SRC}record-audio.ts`, 'utf8');
const flat = source.replace(/\s+/g, ' ');

describe('record-audio.ts configures its own container, never a preset (#154)', () => {
  it('takes no RecordingPreset — both of them are refused by a bucket somewhere', () => {
    // Matched on the IMPORT rather than on the word: a preset cannot be used without being
    // imported, and the docblock above the options explains at length why neither preset is
    // usable here. A bare `toContain` would make that explanation trip its own guard.
    expect(source).not.toMatch(/import[^;]*\bRecordingPresets\b/s);
  });

  it('spells every recording value through MEDIA_LIMITS — rule #10, one tunable module', () => {
    for (const constant of [
      'MEDIA_LIMITS.AUDIO_EXTENSION',
      'MEDIA_LIMITS.AUDIO_SAMPLE_RATE',
      'MEDIA_LIMITS.AUDIO_CHANNELS',
      'MEDIA_LIMITS.AUDIO_BIT_RATE',
    ]) {
      expect(flat, constant).toContain(constant);
    }
  });

  it('indexes the iOS enums by NAME so a renamed member is a type error', () => {
    // Same discipline `pick.ts` applies to UIImagePickerControllerQualityType: the constant
    // holds the member name and the call site indexes the enum with it, so the ordinal is
    // never written down where it could silently change meaning.
    expect(flat).toContain('IOSOutputFormat[MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_IOS]');
    expect(flat).toContain('AudioQuality[MEDIA_LIMITS.AUDIO_QUALITY_IOS]');
  });

  it('configures the Android encoder pair that yields the same m4a iOS writes', () => {
    expect(flat).toContain('MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_ANDROID');
    expect(flat).toContain('MEDIA_LIMITS.AUDIO_ENCODER_ANDROID');
  });

  it('spells none of those values inline', () => {
    for (const literal of ["'.m4a'", "'MPEG4AAC'", "'mpeg4'", "'aac'", '44_100', '64_000']) {
      expect(source, literal).not.toContain(literal);
    }
  });

  it('stops the recording natively at the cap rather than trusting a JS timer alone', () => {
    // `record({ forDuration })` is the only stop that survives the JS thread being busy, and
    // it is the reason a full-length recording lands exactly at the cap instead of past it.
    expect(flat).toContain('forDuration: MEDIA_LIMITS.MAX_CLIP_SECONDS');
  });

  it('puts the session in recording mode before it records', () => {
    // Without `allowsRecording` iOS records silence on a device with the ringer switch off,
    // and the member gets a 60-second file of nothing with no error anywhere.
    expect(flat).toContain('setAudioModeAsync');
    expect(flat).toContain('allowsRecording: true');
  });
});
