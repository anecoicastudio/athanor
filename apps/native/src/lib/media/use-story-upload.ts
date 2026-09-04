import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createStorySegment, softDeleteStorySegment, storyKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import {
  newMediaId,
  processAndUpload,
  storyPath,
  UnsupportedMediaTypeError,
} from '@/lib/media/upload';
import type { PickedMedia } from '@/lib/media/pick';

/**
 * «Add a step» flow for the story composer (#317). The mirror of `useMomentUpload`, INVERTED to
 * row-first: the `story-segments` storage SELECT policy hides an object until its descriptor row
 * exists, and storage-api's insert returns the object row (subject to SELECT), so bytes-then-row
 * fails under that policy (#272 / #31). Order here: mint a media id → insert the `story_segments`
 * row pointing at the path → upload the bytes.
 *
 * The path's UUID is `newMediaId()`, not the row PK — same as `momentPath`: the storage policies
 * key on the uid folder, and the row carries the full path, so the two ids never need to match.
 *
 * If the upload fails after the row landed, the row is soft-deleted best-effort so the rail never
 * grows a ring whose segment can't play; the original error still rejects the mutation and the
 * caller surfaces `media.failed`.
 *
 * No poster step, deliberately: `story_segments` has no `thumb_path`, the viewer is a full-screen
 * player, and a poster object would have no descriptor row — the SELECT policy above would make
 * it unreadable orphan bytes.
 *
 * Writes ONLY story_segments — never any Aura/score event (rule #1).
 */
export function useStoryUpload(uid: string | undefined): {
  addSegment: (input: {
    media: PickedMedia;
    caption: string | null;
    isStep: boolean;
  }) => Promise<void>;
  isUploading: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      media,
      caption,
      isStep,
    }: {
      media: PickedMedia;
      caption: string | null;
      isStep: boolean;
    }) => {
      if (!uid) throw new Error('no-uid');
      // A recording cannot become a story segment (#154). `moments` and `story-segments` list no audio
      // type in allowed_mime_types, and `story_kind` is a ('photo','video') enum — so an audio item
      // has neither an object these buckets accept nor a column value this table can hold.
      // story-compose's MediaSheet never passes `allowAudio`, so this is unreachable by
      // construction; it is spelled out because the mapping below reads `kind === 'video' ?
      // 'video' : 'photo'`, and under a widened union that ternary would file a voice note as a
      // PHOTO — silently, with a real row and an unplayable object behind it.
      if (media.kind === 'audio') throw new UnsupportedMediaTypeError(media.mimeType);
      const mediaId = newMediaId();
      const path = storyPath(uid, mediaId, media.kind);
      const segment = await createStorySegment(supabase, {
        author_id: uid,
        kind: media.kind === 'video' ? 'video' : 'photo',
        storage_path: path,
        duration_s: media.duration_s ?? null,
        caption,
        is_step: isStep,
      });
      try {
        await processAndUpload(media, { bucket: 'story-segments', path });
      } catch (err) {
        try {
          await softDeleteStorySegment(supabase, segment.id);
        } catch {
          // Best-effort only — the upload error below is the one the member acts on.
        }
        throw err;
      }
    },
    onSuccess: async () => {
      if (!uid) return;
      // Rail + own person: `subscribeNewStories` skips your own insert (community.tsx), so the
      // composer invalidates both itself.
      await queryClient.invalidateQueries({ queryKey: storyKeys.rail() });
      await queryClient.invalidateQueries({ queryKey: storyKeys.person(uid) });
    },
  });

  return {
    addSegment: (input: { media: PickedMedia; caption: string | null; isStep: boolean }) =>
      mutation.mutateAsync(input).then(() => undefined),
    isUploading: mutation.isPending,
  };
}
