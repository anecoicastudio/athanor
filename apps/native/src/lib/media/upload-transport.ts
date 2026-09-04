/**
 * XHR upload transport: progress, cancellation, and a no-progress watchdog (#294).
 *
 * XHR rather than `fetch` because RN's fetch has no upload-progress signal, while its
 * XMLHttpRequest dispatches `upload.onprogress` from the native layer and accepts a
 * `{ uri }` body the native layer resolves itself — no `arrayBuffer()` in the JS heap first.
 *
 * **What `{ uri }` costs is platform-split, and only Android gets the good half (#449).** On
 * Android `NetworkingModule` turns it into a file input stream and the request body really is
 * streamed at constant memory. On iOS `RCTNetworkTask` appends every chunk into one
 * `NSMutableData` and `RCTNetworking` assigns the result as `request.HTTPBody`, so the entire
 * file is resident in native memory before a byte leaves — and inside Expo Go that is an OS
 * jetsam kill, not a catchable error. The JS heap is spared on both; iOS's native heap is not.
 * The defence is upstream, at the picker (`pick.ts` compresses); #450 removes the allocation.
 *
 * The timeout is a stall watchdog, not a wall-clock cap: a large video on a slow but
 * moving connection must never be killed, a transfer with zero bytes for
 * `UPLOAD_STALL_TIMEOUT_MS` should be. The timer re-arms on every progress event.
 *
 * The window before the FIRST progress event is a different measurement and gets its own,
 * longer budget — see `UPLOAD_FIRST_PROGRESS_TIMEOUT_MS`.
 *
 * Pure module (no expo/supabase imports): XHR construction and timers are injectable,
 * so the abort/stall/progress logic is unit-testable with a fake XHR (same convention
 * as `paths.ts` / `media-state.ts` beside it).
 */

/** Abort an upload after this long with ZERO bytes moved — stall, not total duration. */
export const UPLOAD_STALL_TIMEOUT_MS = 30_000;

/**
 * How long the transport waits for the FIRST progress event before calling it a stall (#449).
 *
 * Separate from `UPLOAD_STALL_TIMEOUT_MS` because it measures something else. Between two
 * progress events, silence means the connection died. Before the first one, silence means the
 * native layer has not finished preparing the body — and on iOS preparing the body is reading
 * the whole file (up to `MAX_VIDEO_BYTES`) into memory and letting `NSURLSession` copy it.
 * Nothing can be on the wire yet, so the stall window was measuring an event that had not been
 * given a chance to happen, and a large file on a loaded device was aborted as
 * `UploadStalledError` while it was working.
 *
 * Long, but still a bound: a request that never moves at all has to end, or the upload tile
 * spins at 0% forever with no exit but leaving the screen — the defect family #412 exists to
 * delete. Three minutes covers the read; nothing legitimate takes longer to produce one byte.
 */
export const UPLOAD_FIRST_PROGRESS_TIMEOUT_MS = 180_000;

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
 * The picked container is outside `MEDIA_LIMITS.VIDEO_MIME_TYPES`, so nothing was sent (#461).
 *
 * Decided BEFORE the transport runs — it is the one member of this taxonomy that never touched
 * the wire — but it lives here because `uploadErrorKey` is the single door from a media failure
 * to a message, and a second door is how a refusal ends up unnamed.
 *
 * It exists at all because the alternative is the bug: `processAndUpload` used to declare every
 * video `video/mp4` regardless of what it actually was, which passed the bucket's
 * `allowed_mime_types` check on the header while the real bytes landed under an mp4 label. A
 * container the buckets refuse has to be refused HERE, by name, rather than mislabelled into
 * acceptance.
 */
export class UnsupportedMediaTypeError extends Error {
  /** The type the picker reported, or undefined when it named none. For the dev log only. */
  readonly mimeType: string | undefined;
  constructor(mimeType: string | undefined) {
    super(`unsupported-media-type${mimeType ? `: ${mimeType}` : ''}`);
    this.name = 'UnsupportedMediaTypeError';
    this.mimeType = mimeType;
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
  /**
   * Handed to `xhr.send` verbatim — on RN `{ uri: 'file://…' }` is resolved by the native
   * networking layer. Streamed from disk on Android, read whole into native memory on iOS; see
   * the module docblock.
   */
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
  firstProgressTimeoutMs?: number;
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
  const firstProgressTimeoutMs = deps.firstProgressTimeoutMs ?? UPLOAD_FIRST_PROGRESS_TIMEOUT_MS;
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
    const armWatchdog = (ms: number) => {
      clearWatchdog();
      watchdog = timers.set(() => {
        abortReason = 'stalled';
        xhr.abort();
      }, ms);
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
      // First progress event narrows the window: from here on, silence really is a stall.
      armWatchdog(stallTimeoutMs);
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

    // Armed on the first-progress budget, not the stall one: `send` is where iOS reads the
    // whole file, and no progress event can fire until it has (#449).
    armWatchdog(firstProgressTimeoutMs);
    xhr.send(req.body);
  });
}

/**
 * The i18n key an upload failure surfaces under. Cancelled, stalled and an unreadable container
 * each read differently from a plain failure (#294, #461) — same catch sites, four messages.
 *
 * `media.unsupportedType` is the copy the candidacy tile already shows for the same refusal
 * (`candidacy-video-status.ts`), so the compose flows now say the one thing a member can act on
 * — «prova con un altro video» — instead of a generic «non riuscito» they can only repeat.
 */
export function uploadErrorKey(
  err: unknown,
):
  | 'media.canceled'
  | 'media.stalled'
  | 'media.unsupportedType'
  | 'media.unsupportedAudio'
  | 'media.failed' {
  if (err instanceof UploadCanceledError) return 'media.canceled';
  if (err instanceof UploadStalledError) return 'media.stalled';
  // The refused container names its own family (#154). `media.unsupportedType` says «Questo
  // formato video… Prova con un altro video», which is the right sentence for a picked file
  // and the wrong one for a voice note the member just recorded — every noun in it is wrong,
  // and its advice is something they cannot act on. Read off the type the error already
  // carries rather than threading a kind down here: the mime IS the family.
  if (err instanceof UnsupportedMediaTypeError) {
    return err.mimeType?.toLowerCase().startsWith('audio/')
      ? 'media.unsupportedAudio'
      : 'media.unsupportedType';
  }
  return 'media.failed';
}

/** Same mapping for a screen's status state machine (`use-candidacy-upload`). */
export function uploadFailureStatus(err: unknown): 'canceled' | 'stalled' | 'error' {
  if (err instanceof UploadCanceledError) return 'canceled';
  if (err instanceof UploadStalledError) return 'stalled';
  return 'error';
}
