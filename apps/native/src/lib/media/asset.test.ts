import { describe, expect, it } from 'vitest';
import type { ImagePickerAsset } from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';
import { toPickedMedia } from './asset';

const asset = (patch: Partial<ImagePickerAsset>): ImagePickerAsset =>
  ({
    uri: 'file:///tmp/a.jpg',
    width: 1200,
    height: 1500,
    ...patch,
  }) as ImagePickerAsset;

describe('toPickedMedia — kind', () => {
  it("type 'video' → video", () => {
    expect(toPickedMedia(asset({ type: 'video' }))?.kind).toBe('video');
  });

  it("type 'image' → image", () => {
    expect(toPickedMedia(asset({ type: 'image' }))?.kind).toBe('image');
  });

  it('an unresolved type falls back to image rather than dropping the asset', () => {
    expect(toPickedMedia(asset({ type: undefined }))?.kind).toBe('image');
  });

  it('livePhoto and pairedVideo are coerced to image', () => {
    expect(toPickedMedia(asset({ type: 'livePhoto' }))?.kind).toBe('image');
    expect(toPickedMedia(asset({ type: 'pairedVideo' as never }))?.kind).toBe('image');
  });
});

describe('toPickedMedia — duration', () => {
  it('milliseconds are converted to whole seconds', () => {
    expect(toPickedMedia(asset({ type: 'video', duration: 45_000 }))?.duration_s).toBe(45);
  });

  it('rounds to the nearest second', () => {
    expect(toPickedMedia(asset({ type: 'video', duration: 45_600 }))?.duration_s).toBe(46);
    expect(toPickedMedia(asset({ type: 'video', duration: 45_400 }))?.duration_s).toBe(45);
  });

  it('a missing duration stays undefined, not 0', () => {
    expect(toPickedMedia(asset({ type: 'image' }))?.duration_s).toBeUndefined();
    expect(toPickedMedia(asset({ type: 'video', duration: null }))?.duration_s).toBeUndefined();
  });
});

describe('toPickedMedia — the 60s video cap', () => {
  const ms = (s: number) => s * 1000;

  it('a video exactly at the cap is accepted', () => {
    const at = toPickedMedia(
      asset({ type: 'video', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS) }),
    );
    expect(at).not.toBeNull();
    expect(at?.duration_s).toBe(MEDIA_LIMITS.MAX_VIDEO_SECONDS);
  });

  it('a video one second past the cap returns null — the caller shows media.tooLong', () => {
    const over = asset({ type: 'video', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 1) });
    expect(toPickedMedia(over)).toBeNull();
  });

  it('the cap applies to videos only — a long-"duration" image still maps', () => {
    const image = asset({ type: 'image', duration: ms(MEDIA_LIMITS.MAX_VIDEO_SECONDS + 120) });
    expect(toPickedMedia(image)).not.toBeNull();
  });

  it('a video with no reported duration is not rejected', () => {
    expect(toPickedMedia(asset({ type: 'video', duration: null }))).not.toBeNull();
  });
});

describe('toPickedMedia — dimensions and passthrough', () => {
  it('carries uri, dimensions and mimeType across', () => {
    const picked = toPickedMedia(
      asset({ type: 'image', uri: 'file:///tmp/b.png', mimeType: 'image/png' }),
    );
    expect(picked).toMatchObject({
      uri: 'file:///tmp/b.png',
      width: 1200,
      height: 1500,
      mimeType: 'image/png',
    });
  });

  it('zero dimensions collapse to undefined rather than a 0 that breaks aspect ratios', () => {
    const picked = toPickedMedia(asset({ type: 'image', width: 0, height: 0 }));
    expect(picked?.width).toBeUndefined();
    expect(picked?.height).toBeUndefined();
  });
});
