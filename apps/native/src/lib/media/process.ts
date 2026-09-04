import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { MEDIA_LIMITS } from '@athanor/core';

/**
 * EXIF/GPS strip + resize — NON-NEGOTIABLE for images (resilience §7.2).
 *
 * The privacy guarantee is the re-encode: passing the decoded pixels back
 * through `saveAsync` writes a fresh JPEG with NO EXIF/GPS/device/timestamp
 * metadata. We resize so the long edge ≤ IMAGE_MAX_LONG_EDGE and compress at
 * IMAGE_QUALITY in the same pass.
 *
 * `opts` overrides those two numbers and nothing else — the re-encode is not optional. An
 * avatar passes AVATAR_MAX_EDGE/AVATAR_QUALITY and gets the identical privacy guarantee.
 *
 * SDK-54 uses the contextual manipulator API:
 *   ImageManipulator.manipulate(uri) → context
 *   context.resize({ width | height }) → context (chainable, ratio-preserving)
 *   context.renderAsync() → ImageRef (has .width/.height/.saveAsync)
 *   ref.saveAsync({ compress, format }) → { uri, width, height }
 * (`manipulateAsync` still exists but is deprecated in favour of this.)
 */
export async function processImage(
  uri: string,
  opts?: { maxEdge?: number; quality?: number },
): Promise<{ uri: string; width: number; height: number }> {
  const cap = opts?.maxEdge ?? MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE;
  const quality = opts?.quality ?? MEDIA_LIMITS.IMAGE_QUALITY;

  // Render once to read the source dimensions — the context can't report them
  // before a render, and we need them to know which axis is the long edge.
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width: srcW, height: srcH } = original;
  const longEdge = Math.max(srcW, srcH);

  // Build the manipulation. We always re-encode (the EXIF strip); we only add a
  // resize step when the image is larger than the cap. Resizing the long edge
  // by a single axis preserves the aspect ratio.
  let context = ImageManipulator.manipulate(uri);
  if (longEdge > cap) {
    context = srcW >= srcH ? context.resize({ width: cap }) : context.resize({ height: cap });
  }

  const ref = await context.renderAsync();
  const result = await ref.saveAsync({
    compress: quality,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Video passthrough — returns the input uri unchanged.
 *
 * CLIENT-SIDE video metadata strip is NOT available without transcode on SDK 54.
 * We rely on iOS limited-PHPicker (exported assets carry no GPS). The server-side
 * backstop is live: the `media-process` edge function strips every MP4's `udta`/`meta`
 * boxes on upload (resilience §7.2 / backend 10 §4.1a), so this passthrough is by
 * design, not a gap.
 */
export async function processVideo(uri: string): Promise<{ uri: string }> {
  return { uri };
}
