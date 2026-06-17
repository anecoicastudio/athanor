import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { candidacyVideoPath, uploadToBucket } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { pickFromLibrary, recordVideo } from './pick';
import type { PickedMedia } from './pick';

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

/**
 * One-video upload for the candidacy wizard (step 4). Generates the candidacy id
 * up front so the file lands at `{uid}/{id}.mp4` BEFORE the row exists; the same
 * id is reused by `submitCandidacy` (rule #1 — no Aura event written here).
 *
 * Video is uploaded raw — client-side EXIF strip is image-only (process.ts);
 * server-side video strip is the M10 defence-in-depth backstop (resilience §7.2).
 *
 * The ≤60s cap is enforced by `pickFromLibrary`/`recordVideo` (they return null
 * when duration_s > MAX_VIDEO_SECONDS). A null asset is silently ignored; the
 * caller surfaces `media.tooLong` / `candidacy.error.video` to the user.
 */
export function useCandidacyUpload(uid: string): {
  candidacyId: string;
  videoPath: string | null;
  status: UploadStatus;
  pick: () => Promise<void>;
  record: () => Promise<void>;
} {
  const [candidacyId] = useState<string>(() => Crypto.randomUUID());
  const [videoPath, setVideoPath] = useState<string | null>(null);
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
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return {
    candidacyId,
    videoPath,
    status,
    pick: () => pickFromLibrary({ allowVideo: true }).then(handle),
    record: () => recordVideo().then(handle),
  };
}
