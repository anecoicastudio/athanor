import { describe, expect, it } from 'vitest';
import {
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
    // `{ uri }` must reach xhr.send untouched — RN's networking layer is what
    // understands it (convertRequestBody streams the file natively).
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

  it('aborts and rejects UploadStalledError when no progress arrives inside the stall window', async () => {
    const { xhr, clock, promise } = start();
    expect(clock.pending?.ms).toBe(UPLOAD_STALL_TIMEOUT_MS);
    clock.fire();
    expect(xhr.abortCalls).toBe(1);
    await expect(promise).rejects.toBeInstanceOf(UploadStalledError);
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
