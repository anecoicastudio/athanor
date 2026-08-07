import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMoment, momentKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { momentPath, newMediaId, processAndUpload } from '@/lib/media/upload';
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
        // TODO(thumb): generate a video poster after upload → thumb_path. Until then
        // a video Momento renders the static ▶ glyph over an empty tile (no poster).
        thumb_path: null,
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
