-- #318: every feed video card renders a bare ▶ — post_media never got the poster column
-- that #131 wired for moments and #282 added for dream_candidacies. The card variant is an
-- image surface; an image renderer given an mp4 draws nothing, so the feed's videos were a
-- column of identical dark rectangles.

alter table public.post_media add column if not exists thumb_path text;

comment on column public.post_media.thumb_path is
  'Poster frame for a video row, a storage key in post-media ({uid}/{postId}/{index}-thumb.jpg). Nullable: extraction is best-effort client-side (#281 rationale — never fail the post for a poster) and rows written before posters existed have no recoverable first frame. Null for image/audio rows. Mirrors moments.thumb_path / dream_candidacies.thumb_path (#318).';

-- No bucket change, unlike #282's candidacy-videos widening: post-media already allows
-- image/jpeg (20260614204500_storage_media_buckets.sql). The poster lands in the same
-- {uid}/… folder as its mp4, so the existing post-media storage policies cover it and
-- media_process_enqueue strips it server-side like any other object in the bucket.
