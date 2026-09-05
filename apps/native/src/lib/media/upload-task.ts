import { File as FsFile, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import type { UploadHandle, Uploader, UploadResponse } from './upload-transport';

/**
 * The one place a request body actually leaves the device (#450).
 *
 * `upload-transport.ts` owns the policy — watchdog, cancellation, the error taxonomy — and knows
 * nothing about how bytes move. This module is the other half: two platform arms behind one
 * `Uploader`, and the only file in the app that names `expo-file-system` or `XMLHttpRequest`.
 * `source-audit.test.ts` §16 asserts that, because the property the fix depends on is that there
 * is exactly one of these.
 *
 * **Native — `expo-file-system`'s `UploadTask`, and this is the whole point of #450.** The app
 * used to POST `{ uri }` through RN's `XMLHttpRequest`, which is platform-split and only Android
 * got the good half: `NetworkingModule` streams it from a file input stream, while iOS's
 * `RCTNetworkTask` appends every chunk into one `NSMutableData` and `RCTNetworking` assigns the
 * result as `request.HTTPBody`. A 100 MiB video was therefore one contiguous native allocation
 * before a byte left — and inside Expo Go that is an OS jetsam kill, not a catchable error.
 * `UploadTask` hands the file URL to `URLSession.uploadTask(with:fromFile:)` on iOS and to
 * okhttp's `file.asRequestBody(...)` on Android: streamed from disk at constant memory on both,
 * with the progress callbacks and the cancellable handle the hand-built XHR existed to keep
 * (#294). No chunking, no TUS, no protocol change — the wire shape is byte-for-byte what
 * `storage-request.ts` builds, `x-upsert` included.
 *
 * `expo/fetch` is NOT the replacement, whatever #450's newest comment says: its
 * `normalizeBodyInitAsync` resolves every body — `Blob`, `ReadableStream`, an `expo-file-system`
 * `File` — to a single `Uint8Array` in the JS heap, and it has no upload-progress signal at all.
 * It would move the allocation from the native heap to the JS heap and lose the watchdog.
 *
 * **Web — a real `XMLHttpRequest` with a real `Blob`.** `expo-file-system` is a no-op stub on
 * web (`ExpoFileSystem.web.ts` resolves `{ body: '', status: 0 }` and warns), so the native arm
 * cannot be shared. Browser XHR is not RN's: it has no `{ uri }` convention, and handing it one
 * stringified to `"[object Object]"` — a 15-byte object written into the bucket, at HTTP 200,
 * which is why `/mobile-qa` forbids uploading through the web harness. Resolving the picker's
 * `blob:` URL to a `Blob` first fixes that, and a browser XHR reports `upload.onprogress` from
 * the same file-backed body, so the watchdog measures the same thing on both surfaces.
 */

/** Bridges an `AbortSignal`-free handle onto whatever the platform gives us. */
function nativeUploader(
  req: Parameters<Uploader>[0],
  hooks: Parameters<Uploader>[1],
): UploadHandle {
  const task = new FsFile(req.file.uri).createUploadTask(req.url, {
    httpMethod: 'POST',
    // Binary, never multipart: storage-api takes the object bytes as the whole body, and the
    // multipart arm would write a second, framed copy of the file to disk before sending.
    uploadType: UploadType.BINARY_CONTENT,
    // Verbatim, both platforms — apikey, Authorization, x-upsert, cache-control, content-type.
    // BINARY_CONTENT sets no Content-Type of its own, so ours is the one on the wire (#461).
    headers: req.headers,
    // iOS defaults to a BACKGROUND URLSession, which is wrong for a watchdogged foreground
    // upload twice over: a discretionary background session may delay the start past the
    // first-progress window, and in Expo Go the session identifier is derived from Expo Go's
    // own bundle id, i.e. shared with every other project on the device.
    sessionType: 'foreground',
    onProgress: ({ bytesSent, totalBytes }) =>
      hooks.onProgress({ loaded: bytesSent, total: totalBytes > 0 ? totalBytes : null }),
  });
  return {
    // Resolves for ANY completed response, 4xx/5xx included — the transport decides what a
    // status means. It rejects only when the file cannot be read, the request fails, or we
    // cancelled it.
    done: task.uploadAsync().then((res) => ({ status: res.status, body: res.body })),
    cancel: () => task.cancel(),
  };
}

function webUploader(req: Parameters<Uploader>[0], hooks: Parameters<Uploader>[1]): UploadHandle {
  const xhr = new XMLHttpRequest();
  let canceled = false;

  const done = (async (): Promise<UploadResponse> => {
    // The picker hands back a `blob:` (or `data:`) URL on web; `fetch` is how it becomes bytes.
    // This one read IS in memory, and on web that is acceptable — no jetsam, and the harness
    // uploads test fixtures, not member video.
    const source = await fetch(req.file.uri);
    if (!source.ok) throw new Error(`upload-source-unreadable (${source.status})`);
    const blob = await source.blob();
    if (canceled) throw new Error('upload-aborted');

    return await new Promise<UploadResponse>((resolve, reject) => {
      xhr.open('POST', req.url);
      for (const [name, value] of Object.entries(req.headers)) {
        xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (e) =>
        hooks.onProgress({ loaded: e.loaded, total: e.lengthComputable ? e.total : null });
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new Error('upload-network-failed'));
      xhr.onabort = () => reject(new Error('upload-aborted'));
      xhr.send(blob);
    });
  })();

  return {
    done,
    cancel: () => {
      // Set before abort(): a cancel that lands while the blob read is still in flight has no
      // XHR to abort yet, and the flag is what stops `send` from happening afterwards.
      canceled = true;
      xhr.abort();
    },
  };
}

/** The uploader for this platform. Resolved per call — cheap, and keeps the module side-effect free. */
export const platformUploader: Uploader = (req, hooks) =>
  Platform.OS === 'web' ? webUploader(req, hooks) : nativeUploader(req, hooks);
