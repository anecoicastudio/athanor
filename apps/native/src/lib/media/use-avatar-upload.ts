import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadAvatarImage } from './avatar-upload';
import type { PickedMedia } from './pick';

export type AvatarUploadStatus = 'idle' | 'uploading' | 'done' | 'error';

/**
 * Upload one picked image as the member's avatar and hand back its storage key (#76).
 *
 * Deliberately does NOT write `profiles.avatar_path`: the object lands first, the caller decides
 * when the row points at it. The edit form writes the column on Save with the rest of the patch,
 * and onboarding writes it in the post-auth flush — two different moments, one upload path
 * (`avatar-upload.ts`).
 *
 * The key is deterministic (`{uid}/{uid}.jpg`), so replacing a photo overwrites the previous one
 * — no orphan to garbage-collect, but also nothing to bust a cache with. That is why the signed
 * URL for this key is dropped from React Query on success: without it the member picks a new
 * face, the row updates, and the old bytes keep rendering until the URL expires an hour later.
 *
 * A video descriptor is ignored rather than uploaded raw — an avatar is an image.
 */
export function useAvatarUpload(uid: string | null | undefined): {
  status: AvatarUploadStatus;
  /** The uploaded key, or null until an upload succeeds. */
  path: string | null;
  upload: (asset: PickedMedia) => Promise<string | null>;
  reset: () => void;
} {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AvatarUploadStatus>('idle');
  const [path, setPath] = useState<string | null>(null);

  async function upload(asset: PickedMedia): Promise<string | null> {
    if (!uid || asset.kind !== 'image') return null;
    setStatus('uploading');
    try {
      const key = await uploadAvatarImage(uid, asset.uri);
      // Drop the cached signed URL for this exact key — the bytes behind it just changed.
      queryClient.removeQueries({ queryKey: ['avatar-url', key] });
      setPath(key);
      setStatus('done');
      return key;
    } catch {
      setStatus('error');
      return null;
    }
  }

  return {
    status,
    path,
    upload,
    reset: () => {
      setStatus('idle');
      setPath(null);
    },
  };
}
