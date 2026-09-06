/**
 * Upload policy: progress, cancellation, a no-progress watchdog (#294) and the error taxonomy.
 *
 * **How the bytes actually move is not here** — `upload-task.ts` holds the two platform arms
 * behind the `Uploader` seam below, and it is the only file in the app that names
 * `expo-file-system` or `XMLHttpRequest`. This module decides what a status, a silence and an
 * abort each MEAN; that one does the transfer. The split is what lets the policy be unit-tested
 * with a fake uploader in a node environment, which is also why nothing in here may import expo
 * (`candidacy-video-status.ts` imports the error classes and is tested the same way).
 *
 * **#450 is fixed, not deferred, as of this module's rewrite.** The transport used to POST
 * `{ uri }` through RN's `XMLHttpRequest`, whose cost was platform-split: Android streamed the
 * file, iOS read all of it into one `NSMutableData` and assigned it as `HTTPBody`, so a picked
 * video was one contiguous native allocation before the request left — an OS jetsam kill inside
 * Expo Go rather than a catchable error. The body is now file-backed on both platforms (see
 * `upload-task.ts` for the mechanism and for why `expo/fetch` cannot do this job).
 *
 * The timeout is a stall watchdog, not a wall-clock cap: a large video on a slow but
 * moving connection must never be killed, a transfer with zero bytes for
 * `UPLOAD_STALL_TIMEOUT_MS` should be. The timer re-arms on every progress event.
 *
 * The window before the FIRST progress event is a different measurement and gets its own,
 * longer budget — see `UPLOAD_FIRST_PROGRESS_TIMEOUT_MS`.
 */

/** Abort an upload after this long with ZERO bytes moved — stall, not total duration. */
export const UPLOAD_STALL_TIMEOUT_MS = 30_000;

/**
 * How long the transport waits for the FIRST progress event before calling it a stall (#449).
 *
 * Separate from `UPLOAD_STALL_TIMEOUT_MS` because it measures something else. Between two
 * progress events, silence means the connection died. Before the first one, silence means the
 * transfer has not started — and what that covers changed with #450. It used to be iOS reading
 * the whole file (up to `MAX_VIDEO_BYTES`) into memory before `NSURLSession` saw a byte, which
 * is why the stall window was far too short and a large file on a loaded device was aborted as
 * `UploadStalledError` while it was working. With a file-backed body there is no read: what is
 * left is DNS, TLS and the native session actually starting the task.
 *
 * **Deliberately left at three minutes rather than retired.** The read it was sized for is gone,
 * so the number is now generous for what it covers — but it is a bound, not a budget, and
 * nothing legitimate spends it. Narrowing it trades no user-visible benefit for the risk of
 * calling a slow handshake a stall, and the evidence that would justify a new number is device
 * timings this change does not have. A request that never moves at all still has to end, or the
 * upload tile spins at 0% forever with no exit but leaving the screen — the defect family #412
 * exists to delete.
 */
export const UPLOAD_FIRST_PROGRESS_TIMEOUT_MS = 180_000;

export type UploadProgress = {
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes, or null when the platform cannot compute the length. */
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

/** A local file to send, by URI. Never read into this module — only handed to the uploader. */
export type UploadFileRef = {
  /** `file:///…` from the picker on native; a `blob:`/`data:` URL on web. */
  uri: string;
};

/** What a completed request answered, whatever the status. */
export type UploadResponse = {
  status: number;
  body: string;
};

/** A transfer in flight. `cancel()` is idempotent and makes `done` reject. */
export type UploadHandle = {
  /**
   * Resolves for ANY completed response — a 403 is a resolution here, not a rejection, because
   * deciding what a status means is this module's job and not the uploader's. Rejects only when
   * the transfer itself failed or was cancelled; the reason is immaterial, since the transport
   * already knows why it called `cancel()`.
   */
  done: Promise<UploadResponse>;
  cancel: () => void;
};

/**
 * How bytes leave the device. Injected, so the policy above is testable without a platform —
 * `upload-task.ts` is the real one.
 */
export type Uploader = (
  req: { url: string; headers: Record<string, string>; file: UploadFileRef },
  hooks: { onProgress: (p: UploadProgress) => void },
) => UploadHandle;

export type UploadRequest = {
  url: string;
  headers: Record<string, string>;
  file: UploadFileRef;
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
};

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type UploadDeps = {
  /** Required: this module has no default, because a default would mean importing a platform. */
  uploader: Uploader;
  stallTimeoutMs?: number;
  firstProgressTimeoutMs?: number;
  timers?: Timers;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * POST the file at `req.file.uri` to `req.url` (always POST: the storage upload endpoint, with
 * `x-upsert` doing replace-on-retry). Resolves on 2xx; rejects with `UploadCanceledError` /
 * `UploadStalledError` / `UploadHttpError` / a bare network `Error`.
 */
export function uploadFile(req: UploadRequest, deps: UploadDeps): Promise<void> {
  const stallTimeoutMs = deps.stallTimeoutMs ?? UPLOAD_STALL_TIMEOUT_MS;
  const firstProgressTimeoutMs = deps.firstProgressTimeoutMs ?? UPLOAD_FIRST_PROGRESS_TIMEOUT_MS;
  const timers = deps.timers ?? realTimers;

  return new Promise<void>((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(new UploadCanceledError());
      return;
    }

    let watchdog: unknown = null;
    // Why cancel() was called, decided BEFORE calling it — the rejection cannot tell the two
    // apart, and the uploader is not told which of the two it is on purpose.
    let abortReason: 'canceled' | 'stalled' | null = null;
    let settled = false;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        timers.clear(watchdog);
        watchdog = null;
      }
    };

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      req.signal?.removeEventListener('abort', onSignalAbort);
      finish();
    };

    // Declared before `armWatchdog`/`onSignalAbort` can run, but referenced by both — the handle
    // exists by the time either fires, because both are driven by timers or events.
    let handle: UploadHandle | null = null;

    const armWatchdog = (ms: number) => {
      clearWatchdog();
      watchdog = timers.set(() => {
        abortReason = 'stalled';
        handle?.cancel();
      }, ms);
    };

    function onSignalAbort() {
      abortReason = 'canceled';
      handle?.cancel();
    }
    req.signal?.addEventListener('abort', onSignalAbort);

    // Armed BEFORE the transfer starts: the window covers the native session getting going, and
    // no progress event can fire until it has.
    armWatchdog(firstProgressTimeoutMs);

    let started: UploadHandle;
    try {
      started = deps.uploader(
        { url: req.url, headers: req.headers, file: req.file },
        {
          onProgress: (p) => {
            if (settled) return;
            // First progress event narrows the window: from here on, silence really is a stall.
            armWatchdog(stallTimeoutMs);
            req.onProgress?.(p);
          },
        },
      );
    } catch (err: unknown) {
      // An uploader that throws before it returns a handle would otherwise leave this promise
      // pending forever, with the watchdog as the only thing that ever ends the screen's spinner.
      settle(() => reject(new Error(`upload-network-error (${req.url}): ${String(err)}`)));
      return;
    }
    handle = started;

    started.done.then(
      (res) =>
        settle(() => {
          // A cancel that landed while the response was already in flight still reads as a
          // cancel: the member asked, and telling them it succeeded would be a lie.
          if (abortReason !== null) {
            reject(
              abortReason === 'stalled' ? new UploadStalledError() : new UploadCanceledError(),
            );
          } else if (res.status >= 200 && res.status < 300) {
            resolve();
          } else {
            reject(new UploadHttpError(res.status, res.body));
          }
        }),
      (err: unknown) =>
        settle(() => {
          if (abortReason === 'stalled') reject(new UploadStalledError());
          else if (abortReason === 'canceled') reject(new UploadCanceledError());
          else {
            const detail = err instanceof Error ? err.message : String(err);
            reject(new Error(`upload-network-error (${req.url}): ${detail}`));
          }
        }),
    );
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
