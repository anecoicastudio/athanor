import { describe, expect, it } from 'vitest';
import { mediaState } from './media-state';

describe('mediaState', () => {
  it('says loading only while a URL is genuinely on its way', () => {
    expect(mediaState({ isLoading: true })).toBe('loading');
  });

  it('says ready as soon as there is a URL', () => {
    expect(mediaState({ url: 'https://x/y.jpg', isLoading: false })).toBe('ready');
  });

  it('says unavailable when signing has settled and no URL arrived', () => {
    // Both failure modes land here and neither throws to the caller: a per-path omission
    // (packages/api/src/storage.ts drops rows whose signedUrl is null) and a whole-batch
    // throw (useSignedUrls returns `urls: {}` with isLoading false). "Not loading, no URL"
    // is the only evidence the caller ever gets.
    expect(mediaState({ isLoading: false })).toBe('unavailable');
  });

  it('keeps showing media through a background re-sign', () => {
    // story-segments re-signs every 240s inside one mount (signed-url-policy.ts). If a
    // refetch outranked the cached URL, a story would flash a ghost box over media the
    // member is actively watching, once every four minutes.
    expect(mediaState({ url: 'https://x/y.jpg', isLoading: true })).toBe('ready');
  });

  it('treats a signed-but-dead URL as unavailable, not ready', () => {
    // The object was deleted, or the URL outlived its TTL. It signs fine and 404s on GET,
    // so only the renderer's onError knows. Without this arm that failure is silent.
    expect(mediaState({ url: 'https://x/gone.jpg', isLoading: false, failed: true })).toBe(
      'unavailable',
    );
  });

  it('lets failure outrank loading too, so a retry cannot flicker back to a ghost', () => {
    expect(mediaState({ url: 'https://x/gone.jpg', isLoading: true, failed: true })).toBe(
      'unavailable',
    );
    expect(mediaState({ isLoading: true, failed: true })).toBe('unavailable');
  });

  it('never returns ready without a URL', () => {
    // The whole bug: a `null` render inside a full-height frame. Nothing may reach the
    // ready branch without something to put in it.
    for (const isLoading of [true, false]) {
      for (const failed of [true, false, undefined]) {
        expect(mediaState({ isLoading, failed })).not.toBe('ready');
      }
    }
  });

  it('distinguishes loading from unavailable — the property the screens lacked', () => {
    // Guards the direction, not just the values: a mutant collapsing the two states would
    // keep every single-case assertion above passing for one of the two arms.
    expect(mediaState({ isLoading: true })).not.toBe(mediaState({ isLoading: false }));
  });

  it('is total — every input combination resolves to one of the three states', () => {
    const states = ['loading', 'ready', 'unavailable'];
    for (const url of ['https://x/y.jpg', undefined]) {
      for (const isLoading of [true, false]) {
        for (const failed of [true, false, undefined]) {
          expect(states).toContain(mediaState({ url, isLoading, failed }));
        }
      }
    }
  });

  it('reads an empty-string URL as no URL', () => {
    // signMediaUrls filters falsy paths, but a row with an empty storage_path would map to
    // '' here — and `<Image source={{ uri: '' }} />` renders nothing, silently.
    expect(mediaState({ url: '', isLoading: false })).toBe('unavailable');
    expect(mediaState({ url: '', isLoading: true })).toBe('loading');
  });
});
