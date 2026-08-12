/**
 * Which of the three things a media surface can be showing (issue #135).
 *
 * Private media renders from a signed URL, and there are three situations, not two: the URL is
 * still being minted, it is here, or it is never coming. Before this, every surface had one
 * `url ? … : …` conditional, so "signing in flight" and "gone" were the same pixel — a photo
 * rendered `null` inside a full-height frame while a video in the same state rendered a `▶`.
 *
 * `useSignedUrls` gives no error signal by design: `signMediaUrls` omits paths that fail to sign,
 * and a whole-batch throw surfaces as an empty map with `isLoading` false. So absence-after-
 * settling IS the failure evidence, and `failed` carries the one case absence cannot express —
 * a URL that signed fine and then 404s, which only the renderer's `onError` ever learns.
 */
export type MediaState = 'loading' | 'ready' | 'unavailable';

export function mediaState({
  url,
  isLoading,
  failed,
}: {
  /** Signed URL for this path, or undefined while it is absent from the map. */
  url?: string;
  /** The signing query's `isLoading` — thread it from `useSignedUrls`, never drop it. */
  isLoading: boolean;
  /** The renderer reported the URL unusable (dead object, expired TTL). */
  failed?: boolean;
}): MediaState {
  // Failure outranks everything: a dead URL is not something to keep rendering, and a refetch
  // arriving behind it must not flicker the frame back to a ghost.
  if (failed) return 'unavailable';
  // A cached URL outranks `isLoading`, because story-segments re-sign on a 240s timer inside a
  // single mount — a background re-sign must never blank media the member is watching.
  if (url) return 'ready';
  return isLoading ? 'loading' : 'unavailable';
}
