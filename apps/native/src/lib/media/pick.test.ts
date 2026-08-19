import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from '@athanor/core';

/**
 * Source audit, same idiom as `candidacy-video-status.test.ts:272` — `environment: 'node'`
 * cannot drive a picker, and `pick.ts` imports `expo-image-picker` at the top level, so the
 * options that must reach the native picker are pinned by reading the source.
 *
 * These assertions exist because the defect they guard against was an *absence* (#449): the
 * picker was called with no compression option at all, so iOS handed back a 4K original and
 * the upload then materialised the whole thing in native RAM. Nothing observable in JS fails
 * when that option goes missing again — the app just dies on a device.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url).href);
const source = readFileSync(`${SRC}pick.ts`, 'utf8');
/** Prettier wraps these option lines at 100 columns; the assertions are about the call, not its layout. */
const flat = source.replace(/\s+/g, ' ');

describe('pick.ts asks iOS to compress every video it can hand back (#449)', () => {
  it('records at the MEDIA_LIMITS capture quality, never the picker default', () => {
    // `launchCameraAsync` presents UIImagePickerController, whose `videoQuality` defaults to
    // High = the device maximum. Both camera launches that accept 'videos' must set it.
    expect(flat).toContain(
      'videoQuality: ImagePicker.UIImagePickerControllerQualityType[MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS]',
    );
    expect(flat.match(/videoQuality: ImagePicker\./g) ?? []).toHaveLength(2);
  });

  it('transcodes a library pick at the MEDIA_LIMITS export preset', () => {
    // Default is Passthrough — no compression whatsoever. Both library launches that can
    // return a video must set it.
    expect(flat).toContain(
      'videoExportPreset: ImagePicker.VideoExportPreset[MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS]',
    );
    expect(flat.match(/videoExportPreset: ImagePicker\./g) ?? []).toHaveLength(2);
  });

  it('spells neither value inline — rule #10 keeps them tunable from one module', () => {
    expect(source).not.toContain("'Medium'");
    expect(source).not.toContain("'MediumQuality'");
    expect(MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS).toBe('Medium');
    expect(MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS).toBe('MediumQuality');
  });
});
