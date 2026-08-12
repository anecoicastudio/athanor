import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { candidacyThumbPath, candidacyVideoPath, uploadToBucket } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { ensureCameraPermission, ensureLibraryPermission } from './permissions';
import { extractVideoPoster } from './poster';
import { pickFromLibrary, recordVideo } from './pick';
import { uploadLocalFile } from './upload';
import type { PickedMedia } from './pick';

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

/**
 * One-video upload for the candidacy wizard (step 4). Generates the candidacy id
 * up front so the file lands at `{uid}/{id}.mp4` BEFORE the row exists; the same
 * id is reused by `submitCandidacy` (rule #1 — no Aura event written here).
 *
 * A poster frame is extracted and uploaded beside it as `{uid}/{id}-thumb.jpg`, so the ballot
 * card has an image to draw instead of one grey rectangle per candidate (#282). That step is
 * best-effort and returns null on any failure — see `uploadPoster` for why it can never fail the
 * video.
 *
 * Video is uploaded raw — client-side EXIF strip is image-only (process.ts);
 * server-side video strip is the M10 defence-in-depth backstop (resilience §7.2).
 * The poster is a re-encoded JPEG, so it carries no EXIF either.
 *
 * The ≤60s cap is enforced by `pickFromLibrary`/`recordVideo` (they return null
 * when duration_s > MAX_VIDEO_SECONDS). A null asset is silently ignored; the
 * caller surfaces `media.tooLong` / `candidacy.error.video` to the user.
 */
export function useCandidacyUpload(uid: string): {
  candidacyId: string;
  videoPath: string | null;
  thumbPath: string | null;
  status: UploadStatus;
  pick: () => Promise<void>;
  record: () => Promise<void>;
} {
  const [candidacyId] = useState<string>(() => Crypto.randomUUID());
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [thumbPath, setThumbPath] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');

  async function handle(asset: PickedMedia | null): Promise<void> {
    if (!asset || asset.kind !== 'video') return;
    setStatus('uploading');
    try {
      const path = candidacyVideoPath(uid, candidacyId);
      // Raw fetch → arrayBuffer (same idiom as processAndUpload in upload.ts for videos).
      // RN supports fetch() for file:// URIs returned by the picker/camera.
      const res = await fetch(asset.uri);
      const bytes = await res.arrayBuffer();
      await uploadToBucket(supabase, 'candidacy-videos', path, bytes, 'video/mp4');
      setVideoPath(path);
      setThumbPath(await uploadPoster(uid, candidacyId, asset.uri, asset.duration_s));
      setStatus('done');
    } catch {
      setStatus('error');
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
    pick: () => launch('pick'),
    record: () => launch('record'),
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
 * no-poster state instead.
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
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS);
    if (!poster) return null;
    const path = candidacyThumbPath(uid, candidacyId);
    await uploadLocalFile(poster.uri, { bucket: 'candidacy-videos', path }, 'image/jpeg');
    return path;
  } catch {
    return null;
  }
}
