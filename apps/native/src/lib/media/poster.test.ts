import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Source audit. `poster.ts` imports `expo-video` and `expo-image-manipulator` at the top level,
 * so `environment: 'node'` can never load it — but what it must do with its native handles is
 * exactly the kind of thing that rots silently, so it is pinned by reading the source (same
 * idiom as `candidacy-video-status.test.ts:272`).
 */
const SRC = fileURLToPath(new URL('.', import.meta.url).href);
const source = readFileSync(`${SRC}poster.ts`, 'utf8');
const flat = source.replace(/\s+/g, ' ');

describe('extractVideoPoster releases its native handles on cancellation too (#449)', () => {
  it('takes an AbortSignal', () => {
    expect(flat).toContain('signal?: AbortSignal');
  });

  it('releases as soon as the signal fires, not only when the promise settles', () => {
    // The caller bounds this with `withTimeout`, which abandons rather than cancels. Without
    // an abort listener the decoder and both bitmaps stay alive for as long as the underlying
    // work runs — which is unbounded, and which is why the timeout exists in the first place.
    expect(flat).toContain("signal?.addEventListener('abort'");
    expect(flat).toContain("signal?.removeEventListener('abort'");
  });

  it('clears each handle as it frees it, rather than latching the release shut', () => {
    // A one-shot `if (released) return` latch leaks: the signal can fire while
    // `generateThumbnailsAsync` or `renderAsync` is in flight, and if that call then RESOLVES
    // instead of throwing, the handle it produces is assigned after the latch closed and the
    // `finally` frees nothing. Nulling each handle is what makes the release both idempotent
    // and still effective on anything created after an abort.
    expect(flat).toContain('freeHandle(image); image = null;');
    expect(flat).toContain('freeHandle(frame); frame = null;');
    expect(flat).toContain('freeHandle(player); player = null;');
    expect(flat).not.toContain('if (released) return;');
  });

  it('never lets a release throw out of the abort listener', () => {
    // A throw from an abort listener surfaces as an unhandled error, not a caught one.
    expect(flat).toContain("devWarn('poster.release'");
  });
});
