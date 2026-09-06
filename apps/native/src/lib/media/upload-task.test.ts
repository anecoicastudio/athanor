import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadProgress } from './upload-transport';

/**
 * The platform arms of the upload seam (#450), each behind its module mock.
 *
 * What is worth pinning here is not the plumbing but the four choices that make the fix a fix:
 * the native arm must ask for BINARY_CONTENT (multipart writes a second framed copy of the file
 * to disk), must ask for a FOREGROUND session (a discretionary background session can be delayed
 * past the first-progress window, and in Expo Go its identifier is Expo Go's own bundle id), must
 * pass the headers verbatim (`x-upsert` decides which RLS policy evaluates a retry), and must
 * never resolve a non-2xx into a rejection. The web arm must send a real `Blob` — a `{ uri }`
 * object stringifies to `"[object Object]"` and lands as a 15-byte object at HTTP 200.
 */

const mock = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  /** Every `createUploadTask` call: the URI the File was built from, the URL, the options. */
  tasks: [] as { uri: string; url: string; options: Record<string, unknown> }[],
  /** Settles the pending native upload. */
  settle: {
    resolve: (_: unknown) => {},
    reject: (_: unknown) => {},
  },
  cancels: 0,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mock.os;
    },
  },
}));

vi.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  File: class {
    private readonly uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    createUploadTask(url: string, options: Record<string, unknown>) {
      mock.tasks.push({ uri: this.uri, url, options });
      return {
        uploadAsync: () =>
          new Promise((resolve, reject) => {
            mock.settle.resolve = resolve;
            mock.settle.reject = reject;
          }),
        cancel: () => {
          mock.cancels += 1;
          mock.settle.reject(new Error('cancelled'));
        },
      };
    }
  },
}));

const REQ = {
  url: 'https://x.test/storage/v1/object/moments/u1/m1.mp4',
  headers: {
    apikey: 'k',
    Authorization: 'Bearer t',
    'x-upsert': 'true',
    'cache-control': 'max-age=3600',
    'content-type': 'video/mp4',
  },
  file: { uri: 'file:///tmp/m1.mp4' },
};

function noopHooks() {
  return { onProgress: () => {} };
}

/** The task the arm under test just created — throwing beats a chain of optional chains. */
function lastTask() {
  const task = mock.tasks.at(-1);
  if (!task) throw new Error('createUploadTask was never called');
  return task;
}

beforeEach(() => {
  mock.os = 'ios';
  mock.tasks = [];
  mock.cancels = 0;
});

describe('platformUploader — native', () => {
  it('uploads the file itself, binary and foreground, with every header verbatim', async () => {
    const { platformUploader } = await import('./upload-task');
    platformUploader(REQ, noopHooks());
    expect(mock.tasks).toHaveLength(1);
    const task = lastTask();
    // The File is built from the picked URI — that is the whole fix. Nothing reads it here, so
    // neither heap ever holds the bytes; `URLSession.uploadTask(with:fromFile:)` streams it.
    expect(task.uri).toBe('file:///tmp/m1.mp4');
    expect(task.url).toBe(REQ.url);
    expect(task.options.httpMethod).toBe('POST');
    expect(task.options.uploadType).toBe(0); // BINARY_CONTENT, never MULTIPART
    expect(task.options.sessionType).toBe('foreground');
    expect(task.options.headers).toEqual(REQ.headers);
  });

  it('never hands the AbortSignal to the platform — the transport owns cancellation', async () => {
    // Passing `signal` through would let expo-file-system reject with its own AbortError, and
    // the transport could no longer tell a member's cancel from its own stall watchdog firing.
    const { platformUploader } = await import('./upload-task');
    platformUploader(REQ, noopHooks());
    expect(lastTask().options.signal).toBeUndefined();
  });

  it('normalises native progress to the transport shape, nulling an uncomputable total', async () => {
    const { platformUploader } = await import('./upload-task');
    const seen: UploadProgress[] = [];
    platformUploader(REQ, { onProgress: (p) => seen.push(p) });
    const onProgress = lastTask().options.onProgress as (d: {
      bytesSent: number;
      totalBytes: number;
    }) => void;
    onProgress({ bytesSent: 10, totalBytes: 100 });
    onProgress({ bytesSent: 20, totalBytes: 0 });
    onProgress({ bytesSent: 30, totalBytes: -1 });
    expect(seen).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 20, total: null },
      { loaded: 30, total: null },
    ]);
  });

  it('resolves a non-2xx rather than rejecting it', async () => {
    // `UploadTask` answers a completed response whatever the status, and the seam must keep it
    // that way: the transport promotes storage-api's wrapped 400s off the BODY (#412), which a
    // rejection would have thrown away.
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    mock.settle.resolve({ status: 403, body: 'denied', headers: {} });
    await expect(handle.done).resolves.toEqual({ status: 403, body: 'denied' });
  });

  it('cancel() reaches the native task', async () => {
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    const rejected = expect(handle.done).rejects.toThrow('cancelled');
    handle.cancel();
    expect(mock.cancels).toBe(1);
    await rejected;
  });

  it('takes the same arm on Android', async () => {
    mock.os = 'android';
    const { platformUploader } = await import('./upload-task');
    platformUploader(REQ, noopHooks());
    expect(mock.tasks).toHaveLength(1);
  });
});

describe('platformUploader — web', () => {
  class FakeXhr {
    static last: FakeXhr | null = null;
    opened: { method: string; url: string } | null = null;
    headers: Record<string, string> = {};
    sent: unknown = undefined;
    aborts = 0;
    status = 0;
    responseText = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: {
      onprogress:
        | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void)
        | null;
    } = { onprogress: null };

    constructor() {
      FakeXhr.last = this;
    }
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
      this.aborts += 1;
      this.onabort?.();
    }
  }

  const BLOB = { __blob: true, size: 1234 };

  beforeEach(() => {
    mock.os = 'web';
    FakeXhr.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => BLOB })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Let the two awaits inside the web arm (fetch, then .blob()) run. */
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('sends a real Blob, not the URI object that corrupts the object at HTTP 200', async () => {
    const { platformUploader } = await import('./upload-task');
    platformUploader(REQ, noopHooks());
    await flush();
    const xhr = FakeXhr.last;
    expect(xhr?.opened).toEqual({ method: 'POST', url: REQ.url });
    expect(xhr?.headers).toEqual(REQ.headers);
    // The bug this replaces: browser XHR has no `{ uri }` convention, so the old body
    // stringified to "[object Object]" and 15 bytes landed in the bucket under a 200.
    expect(xhr?.sent).toBe(BLOB);
  });

  it('reports upload progress from the browser, nulling a non-computable length', async () => {
    const { platformUploader } = await import('./upload-task');
    const seen: UploadProgress[] = [];
    platformUploader(REQ, { onProgress: (p) => seen.push(p) });
    await flush();
    FakeXhr.last?.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 100 });
    FakeXhr.last?.upload.onprogress?.({ lengthComputable: false, loaded: 20, total: 0 });
    expect(seen).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 20, total: null },
    ]);
  });

  it('resolves a non-2xx with its body, same contract as the native arm', async () => {
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    await flush();
    const xhr = FakeXhr.last;
    if (xhr) {
      xhr.status = 403;
      xhr.responseText = 'denied';
      xhr.onload?.();
    }
    await expect(handle.done).resolves.toEqual({ status: 403, body: 'denied' });
  });

  it('rejects when the source URL cannot be read at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, blob: async () => BLOB })),
    );
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    await expect(handle.done).rejects.toThrow('upload-source-unreadable (404)');
  });

  it('a cancel during the blob read still stops the request from being sent', async () => {
    // The XHR does not exist yet at that point, so `abort()` has nothing to act on — the flag
    // is what prevents an upload the member already cancelled from going out anyway.
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    handle.cancel();
    await expect(handle.done).rejects.toThrow('upload-aborted');
    expect(FakeXhr.last?.sent).toBeUndefined();
  });

  it('a cancel after the request is in flight aborts the XHR', async () => {
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    await flush();
    const rejected = expect(handle.done).rejects.toThrow('upload-aborted');
    handle.cancel();
    expect(FakeXhr.last?.aborts).toBe(1);
    await rejected;
  });

  it('rejects on a browser network error', async () => {
    const { platformUploader } = await import('./upload-task');
    const handle = platformUploader(REQ, noopHooks());
    await flush();
    const rejected = expect(handle.done).rejects.toThrow('upload-network-failed');
    FakeXhr.last?.onerror?.();
    await rejected;
  });

  it('never touches expo-file-system on web — it is a no-op stub that resolves status 0', async () => {
    // `ExpoFileSystem.web.ts` warns and resolves `{ body: '', status: 0 }`. Sharing the native
    // arm would trade a corrupt object at 200 for no request at all, silently.
    const { platformUploader } = await import('./upload-task');
    platformUploader(REQ, noopHooks());
    await flush();
    expect(mock.tasks).toHaveLength(0);
  });
});
