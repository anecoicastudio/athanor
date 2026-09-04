import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from './limits';

describe('MEDIA_LIMITS', () => {
  it('caps a clip at 60s and post media count', () => {
    expect(MEDIA_LIMITS.MAX_CLIP_SECONDS).toBe(60);
    expect(MEDIA_LIMITS.MAX_POST_MEDIA).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE).toBe(2048);
  });

  it('sizes a video poster below a full image — it only ever fills a grid tile', () => {
    expect(MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE).toBeLessThan(MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE);
    expect(MEDIA_LIMITS.VIDEO_POSTER_QUALITY).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_QUALITY).toBeLessThanOrEqual(1);
  });

  it('sizes an avatar below a poster — it never renders larger than the profile hero (#76)', () => {
    // The `avatars` bucket caps objects at 5 MiB (20260811072211); the point of the edge cap is
    // that a 12 MP camera original is never stored and then downscaled on every single row.
    expect(MEDIA_LIMITS.AVATAR_MAX_EDGE).toBeLessThan(MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE);
    expect(MEDIA_LIMITS.AVATAR_QUALITY).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.AVATAR_QUALITY).toBeLessThanOrEqual(1);
  });

  it('takes the poster frame inside every clip the app accepts', () => {
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeLessThan(MEDIA_LIMITS.MAX_CLIP_SECONDS);
  });

  it('caps a video at the size the server-side strip can still process (#412)', () => {
    // 100 MiB exactly — media-process/index.ts skips anything larger, so a file above this
    // uploads slowly and then silently misses the strip. Accepting only what the backstop
    // can process is what makes the cap worth having.
    expect(MEDIA_LIMITS.MAX_VIDEO_BYTES).toBe(104_857_600);
    expect(MEDIA_LIMITS.MAX_VIDEO_BYTES).toBe(100 * 1024 * 1024);
  });

  it('bounds the poster extraction so a hung decoder cannot hold the tile (#412)', () => {
    // The video is already in Storage by the time the poster runs, so waiting forever for a
    // frame trades a finished upload for a spinner that never stops. Long enough that a normal
    // clip finishes, short enough that a member notices nothing.
    expect(MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS).toBe(15_000);
    expect(MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('bounds the wait for the player to install its item, inside the poster budget', () => {
    // `replaceAsync` resolves before `AVPlayer.replaceCurrentItem` has run — it only schedules
    // that on the main queue — so the extractor waits for the source to actually load before
    // asking for a frame. The wait has to be strictly smaller than the whole-extraction budget:
    // it is the FIRST of four steps, and a load deadline at or above the outer one would leave
    // nothing for generate, render and save.
    expect(MEDIA_LIMITS.VIDEO_POSTER_LOAD_TIMEOUT_MS).toBe(5_000);
    expect(MEDIA_LIMITS.VIDEO_POSTER_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_LOAD_TIMEOUT_MS).toBeLessThan(
      MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS,
    );
  });

  it('names the iOS capture quality that keeps a recording out of jetsam range (#449)', () => {
    // The NAME of an `ImagePicker.UIImagePickerControllerQualityType` member, not its ordinal:
    // `pick.ts` indexes the enum with it, so a renamed member is a type error rather than a
    // number that silently means something else. `High` is the picker's default and is what
    // recorded 4K on the device pass.
    expect(MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS).toBe('Medium');
    expect(MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS).not.toBe('High');
  });

  it('names the iOS export preset that transcodes a library pick (#449)', () => {
    // The NAME of an `ImagePicker.VideoExportPreset` member. Anything other than `Passthrough`
    // (the default) makes expo-image-picker run an AVAssetExportSession over the picked asset,
    // so this value is what turns "no compression at all" into a transcode.
    expect(MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS).toBe('MediumQuality');
    expect(MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS).not.toBe('Passthrough');
  });

  it('accepts mp4 and quicktime — an iPhone records .mov (#412)', () => {
    // Mirrors the candidacy-videos bucket's allowed_mime_types (20260817… widening) and the
    // assertion in supabase/tests/0043_candidacy_videos_storage.test.sql. Rejecting quicktime
    // would reject the primary capture path on iOS, and Expo Go cannot transcode.
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toEqual(['video/mp4', 'video/quicktime']);
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toContain('video/mp4');
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toContain('video/quicktime');
  });

  it('binds audio with the same 60 as video — one clip cap per post (#154)', () => {
    // The cap is per CLIP, not per codec: `post_media.duration_s` is one column under one
    // CHECK with no `kind` predicate, and a post may carry both kinds at once while
    // `derivePostType` collapses it to a single type. A voice note that could run five times
    // longer than the video beside it would make the cap mean two different things in one
    // card. The name says `CLIP` for exactly that reason — it read `MAX_VIDEO_SECONDS` while
    // audio had no capture surface, and #154 gave it one.
    expect(MEDIA_LIMITS.MAX_CLIP_SECONDS).toBe(60);
  });

  it('accepts the two audio containers post-media takes, and no others (#154)', () => {
    // Mirrors the `post-media` bucket's allowed_mime_types (20260614204500, carried forward
    // verbatim by 20260819163146) and NOTHING wider. `moments` and `story-segments` accept no
    // audio at all, which is why audio is offered in the post composer alone.
    expect(MEDIA_LIMITS.AUDIO_MIME_TYPES).toEqual(['audio/mp4', 'audio/mpeg']);
  });

  it('records into a container the bucket already accepts (#154)', () => {
    // The recorder is the only audio source there is, so the container it produces is the only
    // one that ever reaches the bucket. `expo-audio`'s own presets do NOT satisfy this:
    // HIGH_QUALITY is `.m4a` on iOS/Android but `audio/webm` on web, and LOW_QUALITY is `.3gp`
    // (`audio/3gpp`) on Android — both outside the list above, both a 415 at upload. That is
    // why the options are spelled out here rather than taken from `RecordingPresets`.
    const allowed: readonly string[] = MEDIA_LIMITS.AUDIO_MIME_TYPES;
    expect(allowed).toContain(MEDIA_LIMITS.AUDIO_CONTENT_TYPE);
    expect(MEDIA_LIMITS.AUDIO_CONTENT_TYPE).toBe('audio/mp4');
    expect(MEDIA_LIMITS.AUDIO_EXTENSION).toBe('.m4a');
  });

  it('records voice, not music — mono at a bitrate that keeps a minute small (#154)', () => {
    // A 60s clip at these settings is ~0.5 MB, two orders of magnitude under the post-media
    // bucket's 50 MiB object limit, so audio needs no byte cap of its own the way video does:
    // there is no picker door, and the duration cap bounds the bytes because the bitrate is
    // fixed here rather than chosen by a camera.
    expect(MEDIA_LIMITS.AUDIO_CHANNELS).toBe(1);
    expect(MEDIA_LIMITS.AUDIO_BIT_RATE).toBe(64_000);
    expect(MEDIA_LIMITS.AUDIO_SAMPLE_RATE).toBe(44_100);
    const bytesAtCap = (MEDIA_LIMITS.AUDIO_BIT_RATE / 8) * MEDIA_LIMITS.MAX_CLIP_SECONDS;
    expect(bytesAtCap).toBeLessThan(52_428_800);
  });

  it('names the AAC encoder members rather than their ordinals (#154)', () => {
    // Same discipline as VIDEO_CAPTURE_QUALITY_IOS: these are the NAMES of `expo-audio`
    // members, indexed at the call site, so a renamed member is a type error here instead of
    // a value that silently means something else on one platform. AAC in an MPEG-4 container
    // is what makes the file `audio/mp4` on both platforms.
    expect(MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_IOS).toBe('MPEG4AAC');
    expect(MEDIA_LIMITS.AUDIO_QUALITY_IOS).toBe('MEDIUM');
    expect(MEDIA_LIMITS.AUDIO_OUTPUT_FORMAT_ANDROID).toBe('mpeg4');
    expect(MEDIA_LIMITS.AUDIO_ENCODER_ANDROID).toBe('aac');
  });
});
