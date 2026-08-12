import type { Moment } from '@athanor/schemas';

/** The three columns these helpers read. Narrowed so callers can pass anything moment-shaped. */
type MomentMedia = Pick<Moment, 'kind' | 'media_path' | 'thumb_path'>;

/**
 * Which storage path a *tile* should draw, or `null` when there is nothing drawable.
 *
 * A tile is an image surface: whatever it gets is handed to `expo-image`. For a photo that is
 * the moment's own bytes. For a video it can only ever be the poster — `media_path` there is an
 * mp4, and an image renderer given an mp4 draws nothing. That is issue #131 exactly: every video
 * Momento came out a blank tile under a ▶, indistinguishable from every other one.
 *
 * `null` is therefore a real answer, not a failure: a video uploaded before posters existed, or
 * one whose extraction failed, genuinely has no image to show. The caller owes that case its own
 * state — saying "this video won't load" would be a lie, because it plays fine in the lightbox.
 */
export function momentPosterPath(moment: MomentMedia): string | null {
  if (moment.thumb_path) return moment.thumb_path;
  return moment.kind === 'video' ? null : moment.media_path;
}

/**
 * Every storage path a set of momenti needs signed, in one list for one `useSignedUrls` call.
 *
 * A postered video contributes **both** paths: the tile draws the poster, the lightbox plays the
 * mp4, and the two share a single `path → url` map. Signing only the poster would leave the
 * lightbox with nothing to play.
 *
 * Deduped because the query key is the path list — two moments pointing at one object should not
 * split the cache, and Storage should not be asked to sign the same key twice.
 */
export function momentSignPaths(moments: MomentMedia[]): string[] {
  const paths = new Set<string>();
  for (const m of moments) {
    paths.add(m.media_path);
    if (m.thumb_path) paths.add(m.thumb_path);
  }
  return [...paths];
}
