import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { candidacyThumbPath, candidacyVideoPath } from '@athanor/api';
import { ensureCameraPermission, ensureLibraryPermission } from './permissions';
import { extractVideoPoster } from './poster';
import { pickFromLibrary, recordVideo } from './pick';
import { uploadFailureStatus, uploadLocalFile } from './upload';
import type { PickedMedia } from './pick';

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error' | 'canceled' | 'stalled';

/**
 * One-video upload for the candidacy wizard (step 4). Generates the candidacy id
 * up front so the file lands at `{uid}/{id}.mp4` BEFORE the row exists; the same
 * id is reused by `submitCandidacy` (rule #1 — no Aura event written here).
 * The edit flow (#226) passes `existingId` instead, so a replacement video PUTs
 * the SAME `{uid}/{id}.mp4` key and the upsert overwrites the old one — the same
 * no-orphan property the #294 retry path relies on.
 *
 * The upload is cancellable and watched (#294): `cancel` aborts the in-flight transfer,
 * a stalled network aborts itself, and `progress` carries the whole-percent number the
 * tile renders instead of an indeterminate spinner. A canceled or stalled attempt leaves
 * `status` saying which, and retrying (pick/record again) reuses the SAME candidacy id —
 * so the retry PUTs the same `{uid}/{id}.mp4` key and the upsert overwrites whatever the
 * broken attempt left behind (the #294 orphan decision). Leaving the wizard mid-upload
 * aborts too; nothing keeps transferring for a screen that is gone.
 *
 * A poster frame is extracted and uploaded beside it as `{uid}/{id}-thumb.jpg`, so the ballot
 * card has an image to draw instead of one grey rectangle per candidate (#282). That step is
 * best-effort and returns null on any failure — see `uploadPoster` for why it can never fail the
 * video. It shares the attempt's abort signal (cancel actually stops the network), and a
 * canceled poster is just another null: the video is already up, so the attempt still ends
 * 'done'.
 *
 * Video is uploaded raw — client-side EXIF strip is image-only (process.ts);
 * server-side video strip is the M10 defence-in-depth backstop (resilience §7.2).
 * The poster is a re-encoded JPEG, so it carries no EXIF either.
 *
 * The ≤60s cap is enforced by `pickFromLibrary`/`recordVideo` (they return null
 * when duration_s > MAX_VIDEO_SECONDS). A null asset is silently ignored; the
 * caller surfaces `media.tooLong` / `candidacy.error.video` to the user.
 */
export function useCandidacyUpload(
  uid: string,
  existingId?: string,
): {
  candidacyId: string;
  videoPath: string | null;
  thumbPath: string | null;
  status: UploadStatus;
  /** Whole percent 0–100, or null while the total is unknown. */
  progress: number | null;
  pick: () => Promise<void>;
  record: () => Promise<void>;
  cancel: () => void;
} {
  const [candidacyId] = useState<string>(() => existingId ?? Crypto.randomUUID());
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [thumbPath, setThumbPath] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Unmount = abandon: abort whatever is in flight so the transfer dies with the screen.
  useEffect(() => () => controllerRef.current?.abort(), []);

  async function handle(asset: PickedMedia | null): Promise<void> {
    if (!asset || asset.kind !== 'video') return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress(null);
    setStatus('uploading');
    try {
      const path = candidacyVideoPath(uid, candidacyId);
      // Raw video through the shared tail (#294 rerouted this off its own fetch→arrayBuffer
      // copy): `uploadLocalFile` streams the file and carries the signal + progress.
      await uploadLocalFile(asset.uri, { bucket: 'candidacy-videos', path }, 'video/mp4', {
        signal: controller.signal,
        onProgress: ({ loaded, total }) => {
          if (total === null || total <= 0) return;
          const pct = Math.min(100, Math.round((loaded / total) * 100));
          setProgress((prev) => (prev === pct ? prev : pct));
        },
      });
      setVideoPath(path);
      setThumbPath(
        await uploadPoster(uid, candidacyId, asset.uri, asset.duration_s, controller.signal),
      );
      setStatus('done');
    } catch (err) {
      setStatus(uploadFailureStatus(err));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  // Guarded launchers: this path has no MediaSheet/primer, so ensure the
  // permission first (denied/blocked → status 'error', surfaced by the wizard's
  // candidacy.error.video on Continue) and never let a native throw escape.
  async function launch(kind: 'record' | 'pick'): Promise<void> {
    try {
      const perm =
        kind === 'record' ? await ensureCameraPermission() : await ensureLibraryPermission();
      if (perm !== 'granted') {
        setStatus('error');
        return;
      }
      const asset =
        kind === 'record' ? await recordVideo() : await pickFromLibrary({ allowVideo: true });
      await handle(asset);
    } catch {
      setStatus('error');
    }
  }

  return {
    candidacyId,
    videoPath,
    thumbPath,
    status,
    progress,
    pick: () => launch('pick'),
    record: () => launch('record'),
    cancel: () => controllerRef.current?.abort(),
  };
}

/**
 * Extract a poster frame from the picked video and put it beside the uploaded mp4, returning the
 * storage path for `thumb_path` — or `null` if any part of that did not work out.
 *
 * Swallowing the failure is the design, exactly as in `use-moment-upload`. By the time this runs
 * the video is already in Storage and the member is one tap from submitting an application;
 * failing the candidacy because a decoder would not give up a frame would trade a working
 * submission for a missing one. A null lands in `thumb_path` and the ballot card draws its own
 * no-poster state instead. The abort signal is threaded through so cancel stops the transfer,
 * but a canceled poster is swallowed like every other poster failure (#294 keeps this
 * asymmetry deliberately).
 *
 * Extraction reads the *picked* local URI, not the uploaded object — nothing is downloaded back.
 * That's safe here specifically because `handle` above uploads that same `asset.uri` raw, with no
 * processing step in between; unlike `use-moment-upload`, which extracts from `processAndUpload`'s
 * *processed* `localUri` because a future video transcode would otherwise leave the poster reading
 * a frame of a video nobody uploaded (see the caution in `upload.ts`'s `processAndUpload`).
 *
 * The poster shares the video's `{uid}/…` folder, so it is covered by the same candidacy-videos
 * policies (including the identity-verified + open-window insert gate, which the video just
 * satisfied) and the `media_process_enqueue` trigger strips it server-side like any other object
 * in the bucket.
 */
async function uploadPoster(
  uid: string,
  candidacyId: string,
  localUri: string,
  durationS: number | null | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS);
    if (!poster) return null;
    const path = candidacyThumbPath(uid, candidacyId);
    await uploadLocalFile(poster.uri, { bucket: 'candidacy-videos', path }, 'image/jpeg', {
      signal,
    });
    return path;
  } catch {
    return null;
  }
}
