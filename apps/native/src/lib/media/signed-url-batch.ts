/**
 * Coalesce per-path signed-URL requests made in the same tick into one signer call.
 *
 * Every other private bucket is read by a screen that already holds all its paths, so
 * `useSignedUrls` takes an array and signs once. An avatar is the opposite shape: it is rendered
 * by a leaf `<Avatar>` deep inside a list row, and the row does not know its siblings. Asking
 * each one to sign its own path would be one `createSignedUrls` POST per row.
 *
 * So the leaf keeps asking per path, and this collects the paths requested in the same tick into
 * a single call. Combined with React Query's cache the effect is one request per distinct avatar
 * per TTL, app-wide — a member seen in a feed row, a chat header and a profile is signed once.
 *
 * No Supabase import on purpose: the batching is the whole point of this module and it has to be
 * testable without a client (and without dragging react-native into the test environment).
 */

export type SignedUrlSigner = (paths: string[]) => Promise<Record<string, string>>;

export function createSignedUrlBatcher(
  sign: SignedUrlSigner,
): (path: string) => Promise<string | null> {
  let waiters: {
    path: string;
    resolve: (v: string | null) => void;
    reject: (e: unknown) => void;
  }[] = [];
  let scheduled = false;

  async function flush(): Promise<void> {
    const batch = waiters;
    waiters = [];
    scheduled = false;
    const paths = [...new Set(batch.map((w) => w.path))];
    try {
      const urls = await sign(paths);
      // A path the signer omitted is not an error — storage RLS may simply deny it (a blocked
      // pair) and the caller renders the initial instead.
      for (const w of batch) w.resolve(urls[w.path] ?? null);
    } catch (err) {
      for (const w of batch) w.reject(err);
    }
  }

  return (path: string) =>
    new Promise<string | null>((resolve, reject) => {
      waiters.push({ path, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        // A microtask, not a timer: everything React renders in one pass queues before this
        // runs, and no wall-clock delay is added to the first paint.
        void Promise.resolve().then(flush);
      }
    });
}
