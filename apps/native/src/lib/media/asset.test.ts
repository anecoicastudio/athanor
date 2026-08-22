import { describe, expect, it } from 'vitest';
import type { ImagePickerAsset } from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';
import {
  REJECTION_MESSAGE,
  classifyVideoAsset,
  resolveVideoContentType,
  toPickedMedia,
} from './asset';

/** The accepted media, or undefined when the door refused — keeps the kind/duration cases terse. */
const picked = (a: Parameters<typeof toPickedMedia>[0]) => {
  const r = toPickedMedia(a);
  return r.outcome === 'picked' ? r.media : undefined;
};

const asset = (patch: Partial<ImagePickerAsset>): ImagePickerAsset =>
  ({
    uri: 'file:///tmp/a.jpg',
    width: 1200,
    height: 1500,
    ...patch,
  }) as ImagePickerAsset;

describe('toPickedMedia — kind', () => {
  it("type 'video' → video", () => {
    expect(picked(asset({ type: 'video' }))?.kind).toBe('video');
  });

  it("type 'image' → image", () => {
    expect(picked(asset({ type: 'image' }))?.kind).toBe('image');
  });

  it('an unresolved type falls back to image rather than dropping the asset', () => {
    expect(picked(asset({ type: undefined }))?.kind).toBe('image');
  });

  it('livePhoto and pairedVideo are coerced to image', () => {
    expect(picked(asset({ type: 'livePhoto' }))?.kind).toBe('image');
    expect(picked(asset({ type: 'pairedVideo' as never }))?.kind).toBe('image');
  });
});

describe('toPickedMedia — duration', () => {
  it('milliseconds are converted to whole seconds', () => {
    expect(picked(asset({ type: 'video', duration: 45_000 }))?.duration_s).toBe(45);
  });

  it('rounds to the nearest second', () => {
    expect(picked(asset({ type: 'video', duration: 45_600 }))?.duration_s).toBe(46);
    expect(picked(asset({ type: 'video', duration: 45_400 }))?.duration_s).toBe(45);
  });

  it('a missing duration stays undefined, not 0', () => {
    expect(picked(asset({ type: 'image' }))?.duration_s).toBeUndefined();
    expect(picked(asset({ type: 'video', duration: null }))?.duration_s).toBeUndefined();
  });
});

describe('toPickedMedia — the 60s video cap', () => {
  const ms = (s: number) => s * 1000;

  it('a video exactly at the cap is accepted', () => {
    const at = toPickedMedia(
      asset({ type: 'video', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS) }),
    );
    expect(at.outcome).toBe('picked');
    expect(at.outcome === 'picked' && at.media.duration_s).toBe(MEDIA_LIMITS.MAX_VIDEO_SECONDS);
  });

  /**
   * The title of this test was true of nothing for two months (#507). The door returned a bare
   * `null`, `MediaSheet` had no arm for it, and the caller showed no message at all — so the
   * assertion below is the one that makes the sentence above it a fact.
   */
  it('a video one second past the cap is rejected — the caller shows media.tooLong', () => {
    const over = asset({ type: 'video', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 1) });
    const result = toPickedMedia(over);
    expect(result).toEqual({ outcome: 'rejected', reason: 'too-long' });
    expect(result.outcome === 'rejected' && REJECTION_MESSAGE[result.reason]).toBe('media.tooLong');
  });

  it('the cap applies to videos only — a long-"duration" image still maps', () => {
    const image = asset({ type: 'image', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 120) });
    expect(toPickedMedia(image).outcome).toBe('picked');
  });

  it('a video with no reported duration is not rejected', () => {
    expect(toPickedMedia(asset({ type: 'video', duration: null })).outcome).toBe('picked');
  });
});

/**
 * The copy each refusal names itself with. Asserted here and not only through
 * `candidacy-video-status.test.ts` because that file now reads this map by spread: if the two
 * ever diverge again it will be because someone added a member here, and this is where the
 * omission has to be loud.
 */
describe('REJECTION_MESSAGE — every refusal names itself', () => {
  it('maps each reason to its own key, never collapsing to media.failed', () => {
    expect(REJECTION_MESSAGE).toEqual({
      'too-long': 'media.tooLong',
      'too-large': 'media.tooLarge',
      'unsupported-type': 'media.unsupportedType',
    });
  });

  it('is what candidacy and compose both read, so one refusal has one sentence', () => {
    // `classifyVideoAsset` produces all three; `toPickedMedia` produces the first. Both hand
    // the reason to this map rather than to a switch of their own.
    const reasons = classifyVideoAsset(asset({ type: 'image' }));
    expect(reasons).toEqual({ outcome: 'rejected', reason: 'unsupported-type' });
    expect(REJECTION_MESSAGE[reasons.outcome === 'rejected' ? reasons.reason : 'too-long']).toBe(
      'media.unsupportedType',
    );
  });
});

describe('toPickedMedia — dimensions and passthrough', () => {
  it('carries uri, dimensions and mimeType across', () => {
    const media = picked(asset({ type: 'image', uri: 'file:///tmp/b.png', mimeType: 'image/png' }));
    expect(media).toMatchObject({
      uri: 'file:///tmp/b.png',
      width: 1200,
      height: 1500,
      mimeType: 'image/png',
    });
  });

  it('zero dimensions collapse to undefined rather than a 0 that breaks aspect ratios', () => {
    const media = picked(asset({ type: 'image', width: 0, height: 0 }));
    expect(media?.width).toBeUndefined();
    expect(media?.height).toBeUndefined();
  });

  it('carries the reported byte size across, and an unreported one stays undefined', () => {
    expect(picked(asset({ type: 'video', fileSize: 1_234 }))?.bytes).toBe(1_234);
    expect(picked(asset({ type: 'video' }))?.bytes).toBeUndefined();
    // 0 bytes is the picker saying nothing useful, not a zero-length file worth uploading.
    expect(picked(asset({ type: 'video', fileSize: 0 }))?.bytes).toBeUndefined();
  });
});

describe('resolveVideoContentType (#412)', () => {
  it('believes a container the bucket accepts', () => {
    expect(resolveVideoContentType('video/mp4')).toBe('video/mp4');
    // The whole point: an iPhone records .mov and this used to be relabelled 'video/mp4'.
    expect(resolveVideoContentType('video/quicktime')).toBe('video/quicktime');
  });

  it('defaults to mp4 when the picker names nothing', () => {
    // Not a rejection: silence is not evidence of a bad type, and mp4 is what this path
    // declared unconditionally before.
    expect(resolveVideoContentType(undefined)).toBe('video/mp4');
    expect(resolveVideoContentType('')).toBe('video/mp4');
  });

  it('normalizes case and drops a codecs parameter before comparing', () => {
    expect(resolveVideoContentType('VIDEO/QuickTime')).toBe('video/quicktime');
    expect(resolveVideoContentType('video/mp4; codecs="avc1.42E01E"')).toBe('video/mp4');
  });

  it('refuses a container the bucket would 415 on', () => {
    expect(resolveVideoContentType('video/x-matroska')).toBeNull();
    expect(resolveVideoContentType('video/3gpp')).toBeNull();
    expect(resolveVideoContentType('image/jpeg')).toBeNull();
  });

  it('accepts exactly what MEDIA_LIMITS declares — the bucket allowlist, one source', () => {
    for (const mime of MEDIA_LIMITS.VIDEO_MIME_TYPES) {
      expect(resolveVideoContentType(mime), mime).toBe(mime);
    }
  });
});

describe('classifyVideoAsset — a rejection says which (#412)', () => {
  const ms = (s: number) => s * 1000;
  const video = (patch: Partial<ImagePickerAsset> = {}) =>
    asset({ type: 'video', duration: ms(30), mimeType: 'video/mp4', ...patch });

  it('an acceptable video comes back with its media and its true Content-Type', () => {
    const out = classifyVideoAsset(video({ mimeType: 'video/quicktime', fileSize: 5_000_000 }));
    expect(out.outcome).toBe('picked');
    if (out.outcome !== 'picked') return;
    expect(out.contentType).toBe('video/quicktime');
    expect(out.media.duration_s).toBe(30);
    expect(out.media.bytes).toBe(5_000_000);
  });

  it('a video one second past the cap is rejected as too-long — not as nothing', () => {
    // The reported defect: `toPickedMedia` answered a bare null here (it names the reason
    // since #507) and the hook early-returned without touching status, so the tile never
    // left `idle`.
    const out = classifyVideoAsset(video({ duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 1) }));
    expect(out).toEqual({ outcome: 'rejected', reason: 'too-long' });
  });

  it('a video exactly at the second cap is accepted', () => {
    const out = classifyVideoAsset(video({ duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS) }));
    expect(out.outcome).toBe('picked');
  });

  it('a video one byte past the byte cap is rejected as too-large', () => {
    const out = classifyVideoAsset(video({ fileSize: MEDIA_LIMITS.MAX_VIDEO_BYTES + 1 }));
    expect(out).toEqual({ outcome: 'rejected', reason: 'too-large' });
  });

  it('a video exactly at the byte cap is accepted — the server can still strip it', () => {
    const out = classifyVideoAsset(video({ fileSize: MEDIA_LIMITS.MAX_VIDEO_BYTES }));
    expect(out.outcome).toBe('picked');
  });

  it('an unreported size does not reject — Storage answers 413 if it matters', () => {
    expect(classifyVideoAsset(video({ fileSize: undefined })).outcome).toBe('picked');
  });

  it('an unreported duration does not reject either', () => {
    expect(classifyVideoAsset(video({ duration: null })).outcome).toBe('picked');
  });

  it('a container the bucket refuses is rejected as unsupported-type, never relabelled', () => {
    const out = classifyVideoAsset(video({ mimeType: 'video/x-matroska' }));
    expect(out).toEqual({ outcome: 'rejected', reason: 'unsupported-type' });
  });

  it('a non-video is rejected rather than silently dropped by the upload', () => {
    // `handle()` used to `return` on `asset.kind !== 'video'` without touching status.
    expect(classifyVideoAsset(asset({ type: 'image' }))).toEqual({
      outcome: 'rejected',
      reason: 'unsupported-type',
    });
  });

  it('duration is judged before size — the cap the screen advertises wins the message', () => {
    const both = video({
      duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 30),
      fileSize: MEDIA_LIMITS.MAX_VIDEO_BYTES * 2,
    });
    expect(classifyVideoAsset(both)).toEqual({ outcome: 'rejected', reason: 'too-long' });
  });
});
