import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { candidacyThumbPath, candidacyVideoPath } from '@athanor/api';
import { MEDIA_LIMITS } from '@athanor/core';
import { devWarn } from '@/lib/log';
import {
  type UploadStatus,
  type VideoFailure,
  identityGateFailure,
  permissionFailure,
  uploadFailureOutcome,
} from '@/lib/candidacy-video-status';
import { ensureCameraPermission, peekLibraryPermission } from './permissions';
import { extractVideoPoster } from './poster';
import { pickVideo } from './pick';
import { uploadLocalFile } from './upload';
import { withTimeout } from './with-timeout';
import type { PickedMedia } from './pick';

// The status/failure vocabulary and every status→message decision live in
// `@/lib/candidacy-video-status` — pure, so the node test runner can collect them (#412),
// the same argument that put the wizard's steps in `@/lib/candidacy-wizard` (#385/#413).
export type { UploadStatus, VideoFailure };

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
 * **Every way this can fail says which (#412).** `status` alone could not: a blocked photo
 * permission, an over-cap video, a refused write and a native throw all collapsed into one
 * `'error'` that the tile did not even draw, so five outcomes rendered as the idle state and
 * were all explained by `candidacy.error.video` on Continue. `failure` now travels beside the
 * status and names the reason; `videoStatusMessage` turns the pair into copy.
 *
 * A poster frame is extracted and uploaded beside it as `{uid}/{id}-thumb.jpg`, so the ballot
 * card has an image to draw instead of one grey rectangle per candidate (#282). That step is
 * best-effort and returns null on any failure — see `uploadPoster` for why it can never fail the
 * video. It shares the attempt's abort signal (cancel actually stops the network), and a
 * canceled poster is just another null: the video is already up, so the attempt still ends
 * 'done'. Extraction is cancelled on its own signal, which the deadline and the attempt's
 * abort both fire (#449).
 *
 * Video is uploaded raw — client-side EXIF strip is image-only (process.ts);
 * server-side video strip is the M10 defence-in-depth backstop (resilience §7.2).
 * The poster is a re-encoded JPEG, so it carries no EXIF either.
 *
 * The Content-Type is the one the picker reported, not a guess: an iPhone records QuickTime
 * and this used to declare `'video/mp4'` for it unconditionally, so `.mov` bytes landed under
 * an mp4 label in `storage.objects.metadata`. `classifyVideoAsset` resolves it against
 * `MEDIA_LIMITS.VIDEO_MIME_TYPES`, which the bucket's `allowed_mime_types` mirrors.
 */
export function useCandidacyUpload(
  uid: string,
  opts: {
    /**
     * `profile.identity_verified`. Required rather than optional-defaulting-to-true: a
     * forgotten argument must be a type error, not a silently disabled gate. Re-read on every
     * render, so a member who verifies mid-wizard and comes back finds the buttons working.
     */
    identityVerified: boolean;
    /** Edit flow (#226): reuse the row's id so a replacement PUTs the same storage key. */
    existingId?: string;
  },
): {
  candidacyId: string;
  videoPath: string | null;
  thumbPath: string | null;
  status: UploadStatus;
  /** Why the attempt failed, when `status` is `'error'`. Null otherwise. */
  failure: VideoFailure | null;
  /** Whole percent 0–100, or null while the total is unknown. */
  progress: number | null;
  pick: () => Promise<void>;
  record: () => Promise<void>;
  cancel: () => void;
} {
  const { identityVerified, existingId } = opts;
  const [candidacyId] = useState<string>(() => existingId ?? Crypto.randomUUID());
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [thumbPath, setThumbPath] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [failure, setFailure] = useState<VideoFailure | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Unmount = abandon: abort whatever is in flight so the transfer dies with the screen.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const fail = (reason: VideoFailure) => {
    setStatus('error');
    setFailure(reason);
  };

  async function transfer(asset: PickedMedia, contentType: string): Promise<void> {
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress(null);
    setFailure(null);
    setStatus('uploading');
    try {
      const path = candidacyVideoPath(uid, candidacyId);
      // Raw video through the shared tail (#294 rerouted this off its own fetch→arrayBuffer
      // copy): `uploadLocalFile` hands the native layer a `{ uri }` body and carries the
      // signal + progress. That body streams from disk on Android and does NOT on iOS, where
      // the whole file becomes one native allocation before the request leaves (#449) — which
      // is why the picker compresses (`pick.ts`) and why #450 exists to remove the allocation.
      await uploadLocalFile(asset.uri, { bucket: 'candidacy-videos', path }, contentType, {
        signal: controller.signal,
        onProgress: ({ loaded, total }) => {
          if (total === null || total <= 0) return;
          const pct = Math.min(100, Math.round((loaded / total) * 100));
          setProgress((prev) => (prev === pct ? prev : pct));
        },
      });
      setVideoPath(path);
      // Bounded (#412): the video is already in Storage by now, so an unbounded poster does
      // not delay a success — it HIDES one, leaving the tile spinning at 100% with Continue
      // disabled, which reads exactly like a failed upload. A poster is best-effort by
      // contract, so the deadline costs a thumbnail and saves the submission.
      // The deadline must CANCEL the extraction, not merely stop waiting for it (#449):
      // `extractVideoPoster` holds a decoder and two bitmaps that it frees when its promise
      // settles, and the assets this deadline exists for are exactly the ones that never
      // settle. Its own controller, because the attempt's controller is already spent —
      // aborting that one here would say 'canceled' about an upload that succeeded — but the
      // attempt's abort is forwarded into it, so leaving the screen frees the decoder too.
      const posterAbort = new AbortController();
      const abortPoster = () => posterAbort.abort();
      controller.signal.addEventListener('abort', abortPoster);
      try {
        setThumbPath(
          await withTimeout(
            uploadPoster(
              uid,
              candidacyId,
              asset.uri,
              asset.duration_s,
              controller.signal,
              posterAbort.signal,
            ),
            MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS,
            null,
            { onTimeout: abortPoster },
          ),
        );
      } finally {
        controller.signal.removeEventListener('abort', abortPoster);
      }
      setStatus('done');
    } catch (err) {
      const outcome = uploadFailureOutcome(err);
      setStatus(outcome.status);
      setFailure(outcome.failure);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  /**
   * Resolve the permission, launch the picker, and report whatever went wrong.
   *
   * Camera is a real gate: nothing records without the grant, so a denied or blocked one ends
   * the attempt with a message and — when blocked — a route into Settings.
   *
   * Library is NOT a gate. `PHPickerViewController` has been the default picker on iOS 14+
   * since expo-image-picker 13 (CHANGELOG #18871); it presents out-of-process and returns an
   * asset with no photo-library authorization at all, and `launchImageLibraryAsync`'s own docs
   * say the permission is required «on iOS 10 only». Demanding `granted` anyway is what made
   * this button permanently inert in Expo Go, where the photo grant is shared across every
   * project so one «Non consentire» tapped in any of them blocks it forever. So we PEEK
   * without prompting and launch regardless; the peek is kept only to explain a launch that
   * then throws — on a platform where the grant does matter, that is the blocked grant, and
   * it is worth a Settings route rather than a bare «non riuscito».
   */
  async function launch(source: 'record' | 'library'): Promise<void> {
    // Before the permission, before the picker, before a single byte: Storage refuses this
    // member's write anyway (the insert policy wants is_identity_verified), and finding that
    // out after a minute of recording and a whole upload is what the device pass reported.
    const gate = identityGateFailure(identityVerified);
    if (gate) {
      fail(gate);
      return;
    }
    let libraryBlocked = false;
    try {
      if (source === 'record') {
        const denial = permissionFailure('camera', await ensureCameraPermission());
        if (denial) {
          fail(denial);
          return;
        }
      } else {
        libraryBlocked = (await peekLibraryPermission()) === 'blocked';
      }
      const picked = await pickVideo(source);
      // Backing out of the picker is not a failure and must not overwrite what the tile says:
      // a member who cancels after a rejection should still be reading why it was rejected.
      if (picked.outcome === 'canceled') return;
      if (picked.outcome === 'rejected') {
        fail(picked.reason);
        return;
      }
      await transfer(picked.media, picked.contentType);
    } catch (err) {
      // Bound, not discarded (#449). The member gets the same deliberately generic copy — a
      // picker throw is not something they can act on — but the reason has to exist somewhere,
      // and in Expo Go the dev console is the only telemetry there is: `Sentry.init` is a hard
      // no-op on that runtime, so a swallowed error here is a report nobody can ever file.
      devWarn('candidacy.launch', err);
      fail(source === 'library' && libraryBlocked ? 'library-blocked' : 'failed');
    }
  }

  return {
    candidacyId,
    videoPath,
    thumbPath,
    status,
    failure,
    progress,
    pick: () => launch('library'),
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
 * asymmetry deliberately). `extractSignal` is the second, narrower one: it cancels the frame
 * extraction alone, so the poster deadline can free a decoder without claiming the finished
 * video upload was canceled (#449).
 *
 * Extraction reads the *picked* local URI, not the uploaded object — nothing is downloaded back.
 * That's safe here specifically because `transfer` above uploads that same `asset.uri` raw, with
 * no processing step in between; unlike `use-moment-upload`, which extracts from
 * `processAndUpload`'s *processed* `localUri` because a future video transcode would otherwise
 * leave the poster reading a frame of a video nobody uploaded (see the caution in `upload.ts`'s
 * `processAndUpload`).
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
  extractSignal: AbortSignal,
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS, extractSignal);
    if (!poster) return null;
    const path = candidacyThumbPath(uid, candidacyId);
    await uploadLocalFile(poster.uri, { bucket: 'candidacy-videos', path }, 'image/jpeg', {
      signal,
    });
    return path;
  } catch (err) {
    devWarn('candidacy.poster', err);
    return null;
  }
}
