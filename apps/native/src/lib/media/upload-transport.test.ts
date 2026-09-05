import { describe, expect, it } from 'vitest';
import {
  UPLOAD_FIRST_PROGRESS_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  UnsupportedMediaTypeError,
  UploadCanceledError,
  UploadHttpError,
  UploadStalledError,
  uploadErrorKey,
  uploadFailureStatus,
  uploadFile,
  type UploadProgress,
  type UploadResponse,
  type Uploader,
} from './upload-transport';

/**
 * A controllable stand-in for `upload-task.ts`. Models the contract the real arms honour: `done`
 * resolves for ANY completed response (a 403 included) and rejects when the transfer failed or
 * was cancelled, and `cancel()` is what makes it reject.
 */
function makeUploader(opts: { throwOnStart?: unknown } = {}) {
  const state = {
    creates: 0,
    cancels: 0,
    req: null as Parameters<Uploader>[0] | null,
    resolve: (_: UploadResponse) => {},
    reject: (_: unknown) => {},
    progress: (_: UploadProgress) => {},
  };
  const uploader: Uploader = (req, hooks) => {
    state.creates += 1;
    if (opts.throwOnStart !== undefined) throw opts.throwOnStart;
    state.req = req;
    state.progress = hooks.onProgress;
    const done = new Promise<UploadResponse>((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
    return {
      done,
      cancel: () => {
        state.cancels += 1;
        state.reject(new Error('upload-aborted'));
      },
    };
  };
  return { state, uploader };
}

/** One pending timer at a time — exactly the watchdog's usage pattern. */
class FakeTimers {
  pending: { fn: () => void; ms: number } | null = null;
  setCalls = 0;

  timers = {
    set: (fn: () => void, ms: number): unknown => {
      this.setCalls += 1;
      this.pending = { fn, ms };
      return this.pending;
    },
    clear: (handle: unknown): void => {
      if (this.pending === handle) this.pending = null;
    },
  };

  fire() {
    const t = this.pending;
    this.pending = null;
    t?.fn();
  }
}

function start(overrides: { signal?: AbortSignal; onProgress?: (p: UploadProgress) => void } = {}) {
  const { state, uploader } = makeUploader();
  const clock = new FakeTimers();
  const promise = uploadFile(
    {
      url: 'https://x.test/storage/v1/object/moments/u1/m1.mp4',
      headers: { apikey: 'k', 'content-type': 'video/mp4', 'x-upsert': 'true' },
      file: { uri: 'file:///tmp/m1.mp4' },
      ...overrides,
    },
    { uploader, timers: clock.timers },
  );
  return { state, clock, promise };
}

describe('uploadFile', () => {
  it('hands the uploader the URL, every header and the file ref untouched, resolving on 2xx', async () => {
    const { state, promise } = start();
    // The transport never reads the file and never rewrites a header: what `storage-request.ts`
    // built is what the platform arm puts on the wire, `x-upsert` included — an upsert over an
    // existing key is evaluated by the bucket's UPDATE policy, so losing it changes which RLS
    // policy decides a retry.
    expect(state.req).toEqual({
      url: 'https://x.test/storage/v1/object/moments/u1/m1.mp4',
      headers: { apikey: 'k', 'content-type': 'video/mp4', 'x-upsert': 'true' },
      file: { uri: 'file:///tmp/m1.mp4' },
    });
    state.resolve({ status: 200, body: '' });
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects UploadHttpError with the status outside 2xx', async () => {
    const { state, promise } = start();
    // A non-2xx RESOLVES the handle — deciding that 403 is a failure is this module's job, and
    // an uploader that rejected it would throw away the body the status lives in (#412).
    state.resolve({ status: 403, body: 'row-level security' });
    await expect(promise).rejects.toMatchObject({ name: 'UploadHttpError', status: 403 });
  });

  it('rejects a plain Error on network failure, carrying the underlying reason', async () => {
    const { state, promise } = start();
    state.reject(new Error('ECONNRESET'));
    await expect(promise).rejects.toThrow('upload-network-error');
    await expect(promise).rejects.toThrow('ECONNRESET');
  });

  it('rejects rather than hanging when the uploader throws before returning a handle', async () => {
    // Nothing would ever settle this promise otherwise: there is no `done` to reject, so the
    // upload tile would spin until the watchdog — the #412 failure mode, one layer down.
    const { uploader } = makeUploader({ throwOnStart: new Error('no such file') });
    await expect(
      uploadFile(
        { url: 'u', headers: {}, file: { uri: 'file:///gone.mp4' } },
        { uploader, timers: new FakeTimers().timers },
      ),
    ).rejects.toThrow('upload-network-error');
  });

  it('rejects UploadCanceledError without starting a transfer when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { state, uploader } = makeUploader();
    await expect(
      uploadFile(
        { url: 'u', headers: {}, file: { uri: 'file:///a.mp4' }, signal: controller.signal },
        { uploader, timers: new FakeTimers().timers },
      ),
    ).rejects.toBeInstanceOf(UploadCanceledError);
    expect(state.creates).toBe(0);
  });

  it('cancels the transfer and rejects UploadCanceledError when the signal fires mid-flight', async () => {
    const controller = new AbortController();
    const { state, clock, promise } = start({ signal: controller.signal });
    controller.abort();
    expect(state.cancels).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(UploadCanceledError);
    // Settling clears the watchdog — nothing left to fire later.
    expect(clock.pending).toBeNull();
  });

  it('waits the FIRST-PROGRESS window, not the stall window, before the first byte (#449)', async () => {
    // The window covers everything between starting the task and the first byte moving — DNS,
    // TLS, the native session starting. #450 removed the whole-file read it was originally
    // sized for; it stays a bound because a transfer that never moves still has to end.
    const { clock } = start();
    expect(clock.pending?.ms).toBe(UPLOAD_FIRST_PROGRESS_TIMEOUT_MS);
    expect(UPLOAD_FIRST_PROGRESS_TIMEOUT_MS).toBeGreaterThan(UPLOAD_STALL_TIMEOUT_MS);
  });

  it('arms the watchdog BEFORE the transfer starts, not after', async () => {
    // Armed after, an uploader that threw or hung inside its own constructor would never be
    // watched at all.
    const clock = new FakeTimers();
    let armedAtStart = -1;
    const uploader: Uploader = () => {
      armedAtStart = clock.setCalls;
      return { done: new Promise<UploadResponse>(() => {}), cancel: () => {} };
    };
    void uploadFile(
      { url: 'u', headers: {}, file: { uri: 'file:///a.mp4' } },
      { uploader, timers: clock.timers },
    );
    expect(armedAtStart).toBe(1);
  });

  it('still cancels and rejects UploadStalledError if the first byte never arrives', async () => {
    // The longer window is a bound, not an amnesty: a request that never moves at all must
    // still end, or the tile spins forever with no way out but leaving the screen.
    const { state, clock, promise } = start();
    clock.fire();
    expect(state.cancels).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(UploadStalledError);
  });

  it('drops to the stall window once bytes are actually moving', async () => {
    const { state, clock } = start();
    state.progress({ loaded: 1, total: 100 });
    expect(clock.pending?.ms).toBe(UPLOAD_STALL_TIMEOUT_MS);
  });

  it('re-arms the watchdog on every progress event — moving bytes never stall out', async () => {
    const { state, clock, promise } = start();
    expect(clock.setCalls).toBe(1);
    state.progress({ loaded: 1, total: 100 });
    expect(clock.setCalls).toBe(2);
    state.progress({ loaded: 2, total: 100 });
    expect(clock.setCalls).toBe(3);
    // Only after the LAST progress event does silence become a stall.
    clock.fire();
    await expect(promise).rejects.toBeInstanceOf(UploadStalledError);
  });

  it('passes progress through verbatim, total null included', async () => {
    const seen: UploadProgress[] = [];
    const { state, promise } = start({ onProgress: (p) => seen.push(p) });
    state.progress({ loaded: 10, total: 100 });
    state.progress({ loaded: 20, total: null });
    state.resolve({ status: 200, body: '' });
    await promise;
    expect(seen).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 20, total: null },
    ]);
  });

  it('ignores progress that arrives after settling — no watchdog is re-armed behind the result', async () => {
    const seen: UploadProgress[] = [];
    const { state, clock, promise } = start({ onProgress: (p) => seen.push(p) });
    state.resolve({ status: 200, body: '' });
    await promise;
    const armedAtSettle = clock.setCalls;
    state.progress({ loaded: 99, total: 100 });
    expect(seen).toEqual([]);
    expect(clock.setCalls).toBe(armedAtSettle);
    expect(clock.pending).toBeNull();
  });

  it('a 2xx that lands after a cancel is still a cancel, not a success', async () => {
    // The member asked for it to stop. `expo-file-system` cancels the native task and then
    // rejects, but a response already in flight can win the race — telling the screen the
    // upload succeeded after the member cancelled it would be a lie about their own action.
    const controller = new AbortController();
    const { state, promise } = start({ signal: controller.signal });
    controller.abort();
    state.resolve({ status: 200, body: '' });
    await expect(promise).rejects.toBeInstanceOf(UploadCanceledError);
  });

  it('ignores a signal abort after settling — no second cancel reaches the uploader', async () => {
    const controller = new AbortController();
    const { state, promise } = start({ signal: controller.signal });
    state.resolve({ status: 200, body: '' });
    await promise;
    controller.abort();
    expect(state.cancels).toBe(0);
  });
});

describe('uploadErrorKey', () => {
  it('maps the four failure shapes to their catalog keys', () => {
    expect(uploadErrorKey(new UploadCanceledError())).toBe('media.canceled');
    expect(uploadErrorKey(new UploadStalledError())).toBe('media.stalled');
    expect(uploadErrorKey(new UploadHttpError(500, ''))).toBe('media.failed');
    expect(uploadErrorKey(new Error('boom'))).toBe('media.failed');
    expect(uploadErrorKey('not-an-error')).toBe('media.failed');
  });

  it('a refused container is named, not folded into the generic failure (#461)', () => {
    // The whole point of the pair: the member is told the format is the problem, which is
    // something they can act on. `media.failed` would be the mislabel's silence in words.
    expect(uploadErrorKey(new UnsupportedMediaTypeError('video/x-matroska'))).toBe(
      'media.unsupportedType',
    );
    expect(uploadErrorKey(new UnsupportedMediaTypeError(undefined))).toBe('media.unsupportedType');
  });

  it('names a refused AUDIO container in its own words, not the video sentence (#154)', () => {
    // `media.unsupportedType` reads «Questo formato video non lo sappiamo leggere. Prova con
    // un altro video.» Told to a member who just recorded a voice note, every noun in it is
    // wrong — and «prova con un altro video» is advice they cannot act on.
    //
    // Unreachable in practice today, because `recordedAudio` refuses an unacceptable container
    // at the recorder door before an upload starts. It is here because `processAndUpload`
    // resolves the type again on its own account (the #461 rule: the bucket believes the
    // header, so the header is checked where it is set), and a second door that can refuse is
    // a second door that can lie.
    expect(uploadErrorKey(new UnsupportedMediaTypeError('audio/webm'))).toBe(
      'media.unsupportedAudio',
    );
    expect(uploadErrorKey(new UnsupportedMediaTypeError('audio/ogg'))).toBe(
      'media.unsupportedAudio',
    );
  });

  it('keeps a video container on the video sentence — the branch reads the family, not a flag', () => {
    expect(uploadErrorKey(new UnsupportedMediaTypeError('video/3gpp'))).toBe(
      'media.unsupportedType',
    );
  });

  it('carries the reported type for the dev log, without putting it on screen', () => {
    expect(new UnsupportedMediaTypeError('video/x-matroska').mimeType).toBe('video/x-matroska');
    expect(new UnsupportedMediaTypeError(undefined).mimeType).toBeUndefined();
  });
});

describe('uploadFailureStatus', () => {
  it('maps the same shapes to screen statuses', () => {
    expect(uploadFailureStatus(new UploadCanceledError())).toBe('canceled');
    expect(uploadFailureStatus(new UploadStalledError())).toBe('stalled');
    expect(uploadFailureStatus(new Error('boom'))).toBe('error');
  });
});

describe('UploadHttpError — the status storage-api MEANT (#412)', () => {
  // Older storage-api wraps every StorageBackendError in an HTTP 400 and states the real
  // status inside the body; newer generations answer the real status on the wire. A copy
  // layer must read the same thing under both, which is what `effectiveStatus` resolves.
  const RLS_BODY =
    '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}';

  it('never lies about what arrived on the wire', () => {
    expect(new UploadHttpError(400, RLS_BODY).status).toBe(400);
  });

  it('carries the body verbatim, empty included', () => {
    expect(new UploadHttpError(400, RLS_BODY).body).toBe(RLS_BODY);
    expect(new UploadHttpError(500, '').body).toBe('');
  });

  it('promotes the 400 an older storage-api wrapped a 403 in', () => {
    expect(new UploadHttpError(400, RLS_BODY).effectiveStatus).toBe(403);
  });

  it('takes a real 403 at its word, no body needed', () => {
    expect(new UploadHttpError(403, '').effectiveStatus).toBe(403);
  });

  it('leaves an unrelated 400 exactly where it is', () => {
    for (const body of [
      '',
      'Bad Request',
      '<html><body>nope</body></html>',
      '{}',
      'null',
      '{"statusCode":"400","error":"InvalidRequest"}',
      '{"statusCode":"nope"}',
      '[{"statusCode":"403"}]',
    ]) {
      expect(new UploadHttpError(400, body).effectiveStatus, JSON.stringify(body)).toBe(400);
    }
  });

  it('never reads an envelope out of a non-400 — the anti-superstition pin', () => {
    expect(new UploadHttpError(500, '{"statusCode":"403"}').effectiveStatus).toBe(500);
    expect(new UploadHttpError(404, '{"statusCode":"403"}').effectiveStatus).toBe(404);
  });

  it('tolerates a numeric statusCode as well as a string one', () => {
    expect(new UploadHttpError(400, '{"statusCode":403}').effectiveStatus).toBe(403);
  });

  it('rejects a statusCode outside the HTTP range', () => {
    expect(new UploadHttpError(400, '{"statusCode":"99"}').effectiveStatus).toBe(400);
    expect(new UploadHttpError(400, '{"statusCode":"600"}').effectiveStatus).toBe(400);
    expect(new UploadHttpError(400, '{"statusCode":"403.5"}').effectiveStatus).toBe(400);
  });

  it('survives a giant non-JSON body without throwing', () => {
    // Throwing while CONSTRUCTING an error is the worst failure mode there is; the
    // startsWith('{') fast path exists so a JSON.parse is never even attempted here.
    expect(new UploadHttpError(400, 'x'.repeat(100_000)).effectiveStatus).toBe(400);
  });

  it('an expired token stays an expired token, not an identity problem', () => {
    expect(
      new UploadHttpError(400, '{"statusCode":"401","error":"Invalid JWT"}').effectiveStatus,
    ).toBe(401);
  });
});
