import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createStorySegment, storyKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { newMediaId, processAndUpload, storyPath } from '@/lib/media/upload';
import type { PickedMedia } from '@/lib/media/pick';

/**
 * Shared «aggiungi un momento»→story flow. Processes + uploads the picked bytes to the
 * `story-segments` bucket (EXIF/GPS stripped for images in process.ts), then inserts the
 * segment row (owner-only via RLS; expires_at defaults to +24h server-side). `isStep` flags
 * «un passo del percorso». Writes ONLY story_segments — never any Aura/score event (rule #1).
 *
 * On success invalidates the rail + the author's person query so the new ring appears.
 */
export function useStoryUpload(uid: string | undefined): {
  addSegment: (m: PickedMedia, opts?: { isStep?: boolean }) => Promise<void>;
  isUploading: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ media, isStep }: { media: PickedMedia; isStep: boolean }) => {
      if (!uid) throw new Error('no-uid');
      const segmentId = newMediaId();
      const path = storyPath(uid, segmentId, media.kind);
      const up = await processAndUpload(media, { bucket: 'story-segments', path });
      await createStorySegment(supabase, {
        author_id: uid,
        kind: media.kind === 'video' ? 'video' : 'photo',
        storage_path: up.storage_path,
        duration_s: up.duration_s ?? null,
        caption: null,
        is_step: isStep,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storyKeys.rail() });
      if (uid) await queryClient.invalidateQueries({ queryKey: storyKeys.person(uid) });
    },
  });

  return {
    addSegment: (m, opts) =>
      mutation.mutateAsync({ media: m, isStep: opts?.isStep ?? false }).then(() => undefined),
    isUploading: mutation.isPending,
  };
}
