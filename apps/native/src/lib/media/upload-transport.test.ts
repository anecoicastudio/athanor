import { describe, expect, it } from 'vitest';
import {
  UPLOAD_FIRST_PROGRESS_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  UploadCanceledError,
  UploadHttpError,
  UploadStalledError,
  uploadErrorKey,
  uploadFailureStatus,
  xhrUpload,
  type UploadProgress,
  type UploadXhr,
  type XhrProgressEvent,
} from './upload-transport';

class FakeXhr implements UploadXhr {
  opened: { method: string; url: string } | null = null;
  headers: Record<string, string> = {};
  sent: unknown = undefined;
  abortCalls = 0;
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: { onprogress: ((e: XhrProgressEvent) => void) | null } = { onprogress: null };

  open(method: string, url: string) {
    this.opened = { method, url };
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.abortCalls += 1;
    this.onabort?.();
  }

  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }
  respond(status: number, responseText = '') {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
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
  const xhr = new FakeXhr();
  const clock = new FakeTimers();
  const promise = xhrUpload(
    {
      url: 'https://x.test/storage/v1/object/moments/u1/m1.mp4',
      headers: { apikey: 'k', 'content-type': 'video/mp4' },
      body: { uri: 'file:///tmp/m1.mp4' },
      ...overrides,
    },
    { createXhr: () => xhr, timers: clock.timers },
  );
  return { xhr, clock, promise };
}

describe('xhrUpload', () => {
  it('POSTs the body verbatim with every header, resolving on 2xx', async () => {
    const { xhr, promise } = start();
    expect(xhr.opened).toEqual({
      method: 'POST',
      url: 'https://x.test/storage/v1/object/moments/u1/m1.mp4',
    });
    expect(xhr.headers).toEqual({ apikey: 'k', 'content-type': 'video/mp4' });
    // `{ uri }` must reach xhr.send untouched — RN's networking layer is what understands it
    // (convertRequestBody). Whether that streams is platform-split; see the module docblock.
    expect(xhr.sent).toEqual({ uri: 'file:///tmp/m1.mp4' });
    xhr.respond(200);
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects UploadHttpError with the status outside 2xx', async () => {
    const { xhr, promise } = start();
    xhr.respond(403, 'row-level security');
    await expect(promise).rejects.toMatchObject({ name: 'UploadHttpError', status: 403 });
  });

  it('rejects a plain Error on network failure', async () => {
    const { xhr, promise } = start();
    xhr.onerror?.();
    await expect(promise).rejects.toThrow('upload-network-error');
  });

  it('rejects UploadCanceledError without creating an XHR when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let created = 0;
    await expect(
      xhrUpload(
        { url: 'u', headers: {}, body: null, signal: controller.signal },
        {
          createXhr: () => {
            created += 1;
            return new FakeXhr();
          },
          timers: new FakeTimers().timers,
        },
      ),
    ).rejects.toBeInstanceOf(UploadCanceledError);
    expect(created).toBe(0);
  });

  it('aborts the XHR and rejects UploadCanceledError when the signal fires mid-flight', async () => {
    const controller = new AbortController();
    const { xhr, clock, promise } = start({ signal: controller.signal });
    controller.abort();
    expect(xhr.abortCalls).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(UploadCanceledError);
    // Settling clears the watchdog — nothing left to fire later.
    expect(clock.pending).toBeNull();
  });

  it('waits the FIRST-PROGRESS window, not the stall window, before the first byte (#449)', async () => {
    // On iOS everything between send() and the first progress event is the native layer
    // reading the whole file into memory — no bytes are on the wire yet and none can be. The
    // stall window measures silence BETWEEN progress events and is far too short to cover
    // that read, so arming it pre-send aborted a working upload of a large file as 'stalled'.
    const { clock } = start();
    expect(clock.pending?.ms).toBe(UPLOAD_FIRST_PROGRESS_TIMEOUT_MS);
    expect(UPLOAD_FIRST_PROGRESS_TIMEOUT_MS).toBeGreaterThan(UPLOAD_STALL_TIMEOUT_MS);
  });

  it('still aborts and rejects UploadStalledError if the first byte never arrives', async () => {
    // The longer window is a bound, not an amnesty: a request that never moves at all must
    // still end, or the tile spins forever with no way out but leaving the screen.
    const { xhr, clock, promise } = start();
    clock.fire();
    expect(xhr.abortCalls).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(UploadStalledError);
  });

  it('drops to the stall window once bytes are actually moving', async () => {
    const { xhr, clock } = start();
    xhr.progress(1, 100);
    expect(clock.pending?.ms).toBe(UPLOAD_STALL_TIMEOUT_MS);
  });

  it('re-arms the watchdog on every progress event — moving bytes never stall out', async () => {
    const { xhr, clock, promise } = start();
    expect(clock.setCalls).toBe(1);
    xhr.progress(1, 100);
    expect(clock.setCalls).toBe(2);
    xhr.progress(2, 100);
    expect(clock.setCalls).toBe(3);
    // Only after the LAST progress event does silence become a stall.
    clock.fire();
    await expect(promise).rejects.toBeInstanceOf(UploadStalledError);
  });

  it('reports progress as bytes, with total null when the length is not computable', async () => {
    const seen: UploadProgress[] = [];
    const { xhr, promise } = start({ onProgress: (p) => seen.push(p) });
    xhr.progress(10, 100);
    xhr.progress(20, 0, false);
    xhr.respond(200);
    await promise;
    expect(seen).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 20, total: null },
    ]);
  });

  it('ignores a signal abort after settling — no second abort reaches the XHR', async () => {
    const controller = new AbortController();
    const { xhr, promise } = start({ signal: controller.signal });
    xhr.respond(200);
    await promise;
    controller.abort();
    expect(xhr.abortCalls).toBe(0);
  });
});

describe('uploadErrorKey', () => {
  it('maps the three failure shapes to their catalog keys', () => {
    expect(uploadErrorKey(new UploadCanceledError())).toBe('media.canceled');
    expect(uploadErrorKey(new UploadStalledError())).toBe('media.stalled');
    expect(uploadErrorKey(new UploadHttpError(500, ''))).toBe('media.failed');
    expect(uploadErrorKey(new Error('boom'))).toBe('media.failed');
    expect(uploadErrorKey('not-an-error')).toBe('media.failed');
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
