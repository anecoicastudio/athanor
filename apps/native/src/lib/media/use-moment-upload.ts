import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMoment, momentKeys } from '@athanor/api';
import { MEDIA_LIMITS } from '@athanor/core';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/media/with-timeout';
import {
  momentPath,
  momentThumbPath,
  newMediaId,
  processAndUpload,
  uploadLocalFile,
} from '@/lib/media/upload';
import { extractVideoPoster } from '@/lib/media/poster';
import type { PickedMedia } from '@/lib/media/pick';

/**
 * Shared «add a Momento» flow, used by both Profilo and the full grid so the
 * upload+create isn't duplicated. Processes + uploads the picked bytes to the
 * `moments` bucket, then inserts the row (owner-only via RLS). Writes ONLY the
 * `moments` table — never any Aura/score event (rule #1).
 *
 * Kind mapping: PickedMedia is `'image'|'video'`; a moment's kind is
 * `'photo'|'video'`. `momentPath` takes the PickedMedia kind for the extension.
 *
 * A video also gets a poster frame extracted and uploaded, so its gallery tile has an image to
 * draw (#131) — see `uploadPoster` below for why that step can never fail the Momento.
 *
 * On success invalidates `momentKeys.list(uid)` so the gallery refetches. On
 * error `addMoment` rejects — the caller surfaces `media.failed`.
 */
export function useMomentUpload(uid: string | undefined): {
  addMoment: (m: PickedMedia) => Promise<void>;
  isUploading: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (m: PickedMedia) => {
      if (!uid) throw new Error('no-uid');
      const momentId = newMediaId();
      const path = momentPath(uid, momentId, m.kind);
      const up = await processAndUpload(m, { bucket: 'moments', path });
      await createMoment(supabase, {
        owner_id: uid,
        kind: m.kind === 'video' ? 'video' : 'photo',
        media_path: up.storage_path,
        thumb_path:
          m.kind === 'video' ? await uploadPoster(uid, momentId, up.localUri, m.duration_s) : null,
        caption: null,
        duration_s: up.duration_s ?? null,
        width: up.width ?? null,
        height: up.height ?? null,
      });
    },
    onSuccess: async () => {
      if (uid) await queryClient.invalidateQueries({ queryKey: momentKeys.list(uid) });
    },
  });

  return {
    addMoment: (m: PickedMedia) => mutation.mutateAsync(m).then(() => undefined),
    isUploading: mutation.isPending,
  };
}

/**
 * Bound the poster step, so a decoder that never settles cannot hold the Momento (#462).
 *
 * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
 * `generateThumbnailsAsync` is bounded — and an iCloud-backed `PHAsset` can take a very long
 * time or never settle. This is awaited INSIDE the `createMoment` argument object, so the row
 * insert itself waits on it: an unbounded extraction does not delay a success, it hides one,
 * and the member is left watching an upload that already finished. `withTimeout` never
 * rejects, so the deadline costs a thumbnail and saves the Momento.
 *
 * The controller is what makes the deadline mean something to the work rather than only to the
 * wait (#449): `extractVideoPoster` checks the signal between native calls and skips the rest.
 * It buys the steps not yet started, never the one in flight — releasing a `VideoPlayer`
 * mid-`AVAssetImageGenerator` runs its deinit off the main thread, which crashes. Unlike the
 * candidacy path there is no outer upload controller to forward from: this hook has no cancel.
 */
async function uploadPoster(
  uid: string,
  momentId: string,
  localUri: string,
  durationS: number | null | undefined,
): Promise<string | null> {
  const posterAbort = new AbortController();
  return withTimeout(
    extractAndUploadPoster(uid, momentId, localUri, durationS, posterAbort.signal),
    MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS,
    null,
    { onTimeout: () => posterAbort.abort() },
  );
}

/**
 * Extract a poster frame from an uploaded video and put it beside the video, returning the
 * storage path for `thumb_path` — or `null` if any part of that did not work out.
 *
 * Swallowing the failure is the whole design. By the time this runs the video is already in
 * Storage and the member is waiting on a row; failing the Momento because a decoder would not
 * give up a frame would trade a working upload for a missing one. `momentPosterPath` reads the
 * resulting null and gives the tile its own state, so a posterless video is handled rather than
 * hidden — which is what the original `TODO(thumb)` never did.
 *
 * Swallowed is not the same as unnamed, which is what this used to be (#462): a bare `catch {}`
 * threw the reason away entirely, and in Expo Go the dev console is the only telemetry there is
 * — `Sentry.init` is a hard no-op on that runtime (#452), so a failure discarded here was a
 * report nobody could ever file. `devWarn` is `__DEV__`-only, so it ships nothing.
 *
 * The poster lands in the same `{uid}/…` folder as the video, so it is covered by the same
 * `moments` storage policies, and the `media_process_enqueue` trigger strips it server-side like
 * any other object in the bucket.
 */
async function extractAndUploadPoster(
  uid: string,
  momentId: string,
  localUri: string,
  durationS: number | null | undefined,
  extractSignal: AbortSignal,
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS, extractSignal);
    if (!poster) return null;
    const path = momentThumbPath(uid, momentId);
    await uploadLocalFile(poster.uri, { bucket: 'moments', path }, 'image/jpeg');
    return path;
  } catch (err) {
    devWarn('moment.poster', err);
    return null;
  }
}
