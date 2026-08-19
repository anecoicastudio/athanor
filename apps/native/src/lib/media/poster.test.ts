import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_LIMITS, videoPosterTime } from '@athanor/core';

/**
 * Runtime harness, not a source audit. `poster.ts` is all native calls, but every one of them is
 * an `expo-*` module that `vi.mock` replaces before the module is ever evaluated — so `environment:
 * 'node'` can load it after all, and the marshalling this file has to get exactly right (#449)
 * gets asserted rather than grepped for. The previous version of this file read `poster.ts` as
 * text; a text audit could never have caught a scalar being passed where iOS wants `[CMTime]`.
 *
 * Mocks are declared through indirection because `vi.mock` factories hoist above the `const`s
 * they close over — the factory body only runs on the dynamic `import()` below, by which time
 * they are initialised (same idiom as `sentry-init.test.ts`).
 */
const saved = { uri: 'file:///cache/poster.jpg', width: 640, height: 360 };
const image = { release: vi.fn(), saveAsync: vi.fn(async () => saved) };
const context = { release: vi.fn(), renderAsync: vi.fn(async () => image) };
const frame = { release: vi.fn() };
const player = {
  replaceAsync: vi.fn(async (_uri: string) => {}),
  generateThumbnailsAsync: vi.fn(async (_times: unknown, _options: unknown) => [frame]),
  release: vi.fn(),
};
const createVideoPlayer = vi.fn((_source: unknown) => player);
const manipulate = vi.fn((_source: unknown) => context);

/**
 * Real `crash-trail`, mocked storage: the point of the markers is the ORDER in which they land
 * relative to the native calls, and a mocked `markStep` would assert nothing about that.
 */
const trail = vi.hoisted(() => new Map<string, string>());
const trailSteps = (): string[] => {
  const raw = trail.get('athanor.crash-trail.v1');
  return raw ? (JSON.parse(raw) as { steps: { s: string }[] }).steps.map((e) => e.s) : [];
};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => trail.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      trail.set(k, v);
    },
    removeItem: async (k: string) => {
      trail.delete(k);
    },
  },
}));

vi.mock('expo-video', () => ({
  createVideoPlayer: (source: unknown) => createVideoPlayer(source),
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (source: unknown) => manipulate(source) },
  SaveFormat: { JPEG: 'jpeg' },
}));

const { extractVideoPoster } = await import('./poster');

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  player.replaceAsync.mockImplementation(async () => {});
  player.generateThumbnailsAsync.mockImplementation(async () => [frame]);
  context.renderAsync.mockImplementation(async () => image);
  image.saveAsync.mockImplementation(async () => saved);
});

describe('the frame time crosses the JS/native boundary as an array (#449)', () => {
  it('passes `[time]`, never the bare number the TS type also allows', async () => {
    // iOS declares `times: [CMTime]?` and expo-modules-core reads it with `getArray()` behind an
    // `assert(isObject())` that Release builds compile out — so a scalar is not a type error at
    // runtime, it is a double's bit pattern dereferenced as an object pointer. EXC_BAD_ACCESS,
    // no JS exception, nothing catchable. The library's own `.d.ts` says `number | number[]`
    // and is wrong about the first half; this assertion is the only thing standing in for it.
    await extractVideoPoster('file:///clip.mp4', 12);

    const call = player.generateThumbnailsAsync.mock.calls[0];
    expect(call).toBeDefined();
    const [times, options] = call as [unknown, unknown];
    expect(Array.isArray(times)).toBe(true);
    expect(times).toEqual([videoPosterTime(12)]);
    expect(options).toEqual({
      maxWidth: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
      maxHeight: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
    });
  });

  it('still wraps when the duration is unknown and the time is 0', async () => {
    // 0 is the case a `times.length ? times : [0]`-style guard would get wrong, and the one an
    // unknown duration always takes.
    await extractVideoPoster('file:///clip.mp4', null);
    expect(player.generateThumbnailsAsync.mock.calls[0]?.[0]).toEqual([0]);
  });
});

describe('happy path', () => {
  it('loads, grabs one frame, re-encodes it to JPEG and returns the saved file', async () => {
    const result = await extractVideoPoster('file:///clip.mp4', 12);

    expect(createVideoPlayer).toHaveBeenCalledWith(null);
    expect(player.replaceAsync).toHaveBeenCalledWith('file:///clip.mp4');
    expect(manipulate).toHaveBeenCalledWith(frame);
    expect(image.saveAsync).toHaveBeenCalledWith({
      compress: MEDIA_LIMITS.VIDEO_POSTER_QUALITY,
      format: 'jpeg',
    });
    expect(result).toEqual(saved);
  });

  it('releases every native handle it took, the manipulator context included', async () => {
    // `ImageManipulator.manipulate` hands back an `ImageManipulatorContext`, which is a
    // `SharedObject` holding the source image alive — it is as much a handle as the player is.
    await extractVideoPoster('file:///clip.mp4', 12);

    expect(image.release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

describe('failures stay best-effort', () => {
  it('returns null and says so when the decoder hands back no frames', async () => {
    // `replaceAsync` resolves before the item is actually installed, so this is reachable on a
    // real device: `currentItem` is nil, generation yields `[]`, and the submission would go out
    // posterless with nothing logged.
    player.generateThumbnailsAsync.mockImplementation(async () => []);

    expect(await extractVideoPoster('file:///clip.mp4', 12)).toBeNull();
    expect(warn).toHaveBeenCalledWith('poster.extract', expect.anything());
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed release escape, and still frees the handles behind it', async () => {
    // Releasing a handle the native side already tore down throws. It must not become the
    // reason a submission fails, and it must not stop the handles queued behind it.
    image.release.mockImplementationOnce(() => {
      throw new Error('already released');
    });

    expect(await extractVideoPoster('file:///clip.mp4', 12)).toEqual(saved);
    expect(warn).toHaveBeenCalledWith('poster.release', expect.any(Error));
    expect(context.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it('returns null and releases when a native call throws', async () => {
    context.renderAsync.mockImplementation(async () => {
      throw new Error('decode failed');
    });

    expect(await extractVideoPoster('file:///clip.mp4', 12)).toBeNull();
    expect(context.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

/**
 * `crash-trail` holds its ring in module state, which this file imports once — so these assert
 * the TAIL of the trail rather than the whole of it. That is the honest shape anyway: what the
 * next launch reads is the last thing reached, not the whole history.
 */
describe('durable step markers land before the native call they mark (#452)', () => {
  it('has already written `poster.thumbnails` by the time generation starts', async () => {
    // The whole feature turns on this ordering. #449 died inside this call with no JS exception;
    // a marker still in flight would have died with it, leaving the next launch nothing to read.
    let stepsAtCallTime: string[] = [];
    player.generateThumbnailsAsync.mockImplementation(async () => {
      stepsAtCallTime = trailSteps();
      return [frame];
    });

    await extractVideoPoster('file:///clip.mp4', 12);

    expect(stepsAtCallTime.slice(-2)).toEqual(['poster.player', 'poster.thumbnails']);
  });

  it('marks the render and save boundaries, then closes the extraction out', async () => {
    let stepsAtSaveTime: string[] = [];
    image.saveAsync.mockImplementation(async () => {
      stepsAtSaveTime = trailSteps();
      return saved;
    });

    await extractVideoPoster('file:///clip.mp4', 12);

    expect(stepsAtSaveTime.slice(-4)).toEqual([
      'poster.player',
      'poster.thumbnails',
      'poster.render',
      'poster.save',
    ]);
    // `release` brackets the frees — expo's own comment calls that teardown a crash site — and
    // `done` is what stops a successful extraction reading as the last thing before a crash.
    expect(trailSteps().slice(-2)).toEqual(['poster.release', 'poster.done']);
  });

  it('marks nothing when the caller aborted before any native handle was taken', async () => {
    const before = trailSteps();
    const controller = new AbortController();
    controller.abort();

    await extractVideoPoster('file:///clip.mp4', 12, controller.signal);

    expect(trailSteps()).toEqual(before);
  });
});

describe('cancellation never releases a handle out from under a live native call (#449)', () => {
  it('does nothing at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await extractVideoPoster('file:///clip.mp4', 12, controller.signal)).toBeNull();
    expect(createVideoPlayer).not.toHaveBeenCalled();
  });

  it('leaves the player alone while generation is in flight, and frees it when it settles', async () => {
    // `release()` does not cancel native work — it drops the last strong reference, so
    // `VideoPlayer.deinit` (11 KVO invalidations plus NotificationCenter teardown) runs wherever
    // the abort happened to fire, possibly mid-`AVAssetImageGenerator`. expo's own comment in
    // `ios/VideoPlayer.swift` says doing this off the main queue "causes crashes". So an abort
    // may only short-circuit the NEXT step; the handles are freed when the promise settles.
    let settle: (frames: unknown[]) => void = () => {};
    player.generateThumbnailsAsync.mockImplementation(
      () => new Promise((resolve) => (settle = resolve as (frames: unknown[]) => void)),
    );
    const controller = new AbortController();

    const pending = extractVideoPoster('file:///clip.mp4', 12, controller.signal);
    await vi.waitFor(() => expect(player.generateThumbnailsAsync).toHaveBeenCalled());
    controller.abort();
    await Promise.resolve();
    expect(player.release).not.toHaveBeenCalled();

    settle([frame]);
    expect(await pending).toBeNull();
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(frame.release).toHaveBeenCalledTimes(1);
  });

  it('does not blame the decoder when a cancellation is what produced no frames', async () => {
    // An abort landing mid-generation can also come back with `[]`. Logging 'no frame' for it
    // would point a future reader at the codec instead of at the deadline the caller set.
    const controller = new AbortController();
    player.generateThumbnailsAsync.mockImplementation(async () => {
      controller.abort();
      return [];
    });

    expect(await extractVideoPoster('file:///clip.mp4', 12, controller.signal)).toBeNull();
    expect(warn).not.toHaveBeenCalledWith('poster.extract', expect.anything());
  });

  it('skips the work that has not started yet', async () => {
    const controller = new AbortController();
    player.replaceAsync.mockImplementation(async () => {
      controller.abort();
    });

    expect(await extractVideoPoster('file:///clip.mp4', 12, controller.signal)).toBeNull();
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});
