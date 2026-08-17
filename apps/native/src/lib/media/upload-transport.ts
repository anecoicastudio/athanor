/**
 * XHR upload transport: progress, cancellation, and a no-progress watchdog (#294).
 *
 * XHR rather than `fetch` because RN's fetch has no upload-progress signal, while its
 * XMLHttpRequest dispatches `upload.onprogress` from the native layer and accepts a
 * `{ uri }` body that streams the file from disk — no 200 MB `arrayBuffer()` in the JS
 * heap first.
 *
 * The timeout is a stall watchdog, not a wall-clock cap: a large video on a slow but
 * moving connection must never be killed, a transfer with zero bytes for
 * `UPLOAD_STALL_TIMEOUT_MS` should be. The timer re-arms on every progress event.
 *
 * Pure module (no expo/supabase imports): XHR construction and timers are injectable,
 * so the abort/stall/progress logic is unit-testable with a fake XHR (same convention
 * as `paths.ts` / `media-state.ts` beside it).
 */

/** Abort an upload after this long with ZERO bytes moved — stall, not total duration. */
export const UPLOAD_STALL_TIMEOUT_MS = 30_000;

export type UploadProgress = {
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes, or null when the native layer cannot compute the length. */
  total: number | null;
};

/** The member cancelled (AbortSignal fired). */
export class UploadCanceledError extends Error {
  constructor() {
    super('upload-canceled');
    this.name = 'UploadCanceledError';
  }
}

/** The watchdog fired: no bytes moved for the stall window. */
export class UploadStalledError extends Error {
  constructor() {
    super('upload-stalled');
    this.name = 'UploadStalledError';
  }
}

/**
 * The status a storage-api envelope declares inside a body, or null when the body is not one.
 *
 * Total by construction, and it must stay that way: this runs while an Error is being built,
 * and an exception thrown there would replace a nameable failure with a crash. Hence the
 * `startsWith('{')` fast path (an HTML error page or an empty body never reaches `JSON.parse`)
 * and the try/catch around the parse itself.
 */
function envelopeStatus(body: string): number | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // storage-api sends it as a STRING ("403"); accept a number too rather than depend on that.
  const raw = (parsed as { statusCode?: unknown }).statusCode;
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isInteger(n) || n < 100 || n > 599) return null;
  return n;
}

/**
 * The status the server *meant*, as opposed to the one it put on the wire.
 *
 * storage-api has two generations: the older one wraps every `StorageBackendError` in an HTTP
 * 400 and states the real status in the body (`{"statusCode":"403",…}` for an RLS denial,
 * `"413"` past the bucket ceiling, `"415"` outside `allowed_mime_types`), while the newer one
 * answers the real status directly. Resolving one effective status here means the copy layer
 * has a single rule that is correct under both, instead of a special case per generation.
 *
 * Only a 400 is ever promoted, and only when the server itself declared the status — so an
 * ordinary bad request stays a bad request. That precision matters: mislabelling a random 400
 * as a 403 would tell a member to go verify their identity for a problem that has nothing to
 * do with it (#412 is an issue about the app saying misleading things — do not add one).
 */
export function effectiveHttpStatus(status: number, body: string): number {
  if (status !== 400) return status;
  return envelopeStatus(body) ?? status;
}

/** The server answered outside 2xx. */
export class UploadHttpError extends Error {
  /** The status on the wire. Never rewritten — the transport does not lie about what arrived. */
  readonly status: number;
  /** The response body verbatim; the only place an older storage-api states the real status. */
  readonly body: string;
  /** What the server meant (see {@link effectiveHttpStatus}). Map copy from THIS one. */
  readonly effectiveStatus: number;
  constructor(status: number, body: string) {
    super(`upload-http-${status}${body ? `: ${body}` : ''}`);
    this.name = 'UploadHttpError';
    this.status = status;
    this.body = body;
    this.effectiveStatus = effectiveHttpStatus(status, body);
  }
}

export type XhrProgressEvent = { lengthComputable: boolean; loaded: number; total: number };

/** The slice of XMLHttpRequest the transport touches — what the fake in the test implements. */
export type UploadXhr = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  status: number;
  responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  upload: { onprogress: ((e: XhrProgressEvent) => void) | null };
};

export type XhrUploadRequest = {
  url: string;
  headers: Record<string, string>;
  /** Handed to `xhr.send` verbatim — on RN `{ uri: 'file://…' }` streams the file natively. */
  body: unknown;
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
};

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type XhrUploadDeps = {
  createXhr?: () => UploadXhr;
  stallTimeoutMs?: number;
  timers?: Timers;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * POST `body` to `url` (always POST: the storage upload endpoint, with `x-upsert` doing
 * replace-on-retry). Resolves on 2xx; rejects with `UploadCanceledError` /
 * `UploadStalledError` / `UploadHttpError` / a bare network `Error`.
 */
export function xhrUpload(req: XhrUploadRequest, deps: XhrUploadDeps = {}): Promise<void> {
  const stallTimeoutMs = deps.stallTimeoutMs ?? UPLOAD_STALL_TIMEOUT_MS;
  const timers = deps.timers ?? realTimers;

  return new Promise<void>((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(new UploadCanceledError());
      return;
    }

    const xhr = deps.createXhr?.() ?? (new XMLHttpRequest() as unknown as UploadXhr);
    let watchdog: unknown = null;
    // Why xhr.abort() fired, decided BEFORE calling it — onabort cannot tell the two apart.
    let abortReason: 'canceled' | 'stalled' | null = null;
    let settled = false;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        timers.clear(watchdog);
        watchdog = null;
      }
    };
    const armWatchdog = () => {
      clearWatchdog();
      watchdog = timers.set(() => {
        abortReason = 'stalled';
        xhr.abort();
      }, stallTimeoutMs);
    };

    const onSignalAbort = () => {
      abortReason = 'canceled';
      xhr.abort();
    };
    req.signal?.addEventListener('abort', onSignalAbort);

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      req.signal?.removeEventListener('abort', onSignalAbort);
      finish();
    };

    xhr.open('POST', req.url);
    for (const [name, value] of Object.entries(req.headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (e) => {
      armWatchdog();
      req.onProgress?.({ loaded: e.loaded, total: e.lengthComputable ? e.total : null });
    };
    xhr.onload = () =>
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new UploadHttpError(xhr.status, xhr.responseText));
      });
    xhr.onerror = () => settle(() => reject(new Error(`upload-network-error (${req.url})`)));
    xhr.onabort = () =>
      settle(() =>
        reject(abortReason === 'stalled' ? new UploadStalledError() : new UploadCanceledError()),
      );

    armWatchdog();
    xhr.send(req.body);
  });
}

/**
 * The i18n key an upload failure surfaces under. Cancelled and stalled read differently
 * from a plain failure (#294) — same catch sites, three messages.
 */
export function uploadErrorKey(err: unknown): 'media.canceled' | 'media.stalled' | 'media.failed' {
  if (err instanceof UploadCanceledError) return 'media.canceled';
  if (err instanceof UploadStalledError) return 'media.stalled';
  return 'media.failed';
}

/** Same mapping for a screen's status state machine (`use-candidacy-upload`). */
export function uploadFailureStatus(err: unknown): 'canceled' | 'stalled' | 'error' {
  if (err instanceof UploadCanceledError) return 'canceled';
  if (err instanceof UploadStalledError) return 'stalled';
  return 'error';
}
