-- post_media.duration_s: narrow the CHECK from 1200 to 60 seconds (#56).
--
-- 60 is not a new bound, it is the bound this column never received. `MEDIA_LIMITS.
-- MAX_VIDEO_SECONDS` in packages/core has said 60 since M3, the picker enforces it on every
-- path (camera, record, library — `toPickedMedia`/`classifyVideoAsset`), and both sibling
-- tables already carry it in SQL: `moments` (20260614204000) and `story_segments`
-- (20260614230531) declare `between 0 and 60`. post_media declaring 1200 was the outlier, so
-- this is a correction rather than a policy change — nothing a member can do through the app
-- produces a row this rejects.
--
-- What it closes is the only path that never met the client: a raw API call or a future web
-- upload writing post_media directly could attach a twenty-minute video. RLS does not help
-- there — the author is genuinely the author — so the CHECK is the guard.
--
-- 20260614203046_post_media.sql declared the constraint inline and stays untouched (migrations
-- are append-only). Postgres cannot edit a CHECK in place, so the constraint is dropped and
-- re-added under the same auto-generated name it already has; a from-zero replay therefore
-- ends in the same catalog state as the hosted projects.
--
-- Safe to apply: staging held 4 post_media rows, none with duration_s over 60 (all NULL);
-- production holds none. Verified before this migration was written, not after.

alter table public.post_media
  drop constraint if exists post_media_duration_s_check;

alter table public.post_media
  add constraint post_media_duration_s_check
  check (duration_s is null or duration_s between 0 and 60);

comment on constraint post_media_duration_s_check on public.post_media is
  'A post clip is at most 60 seconds (#56) — mirrors MEDIA_LIMITS.MAX_VIDEO_SECONDS in packages/core and the .max() in packages/schemas post-media.ts, which packages/schemas/src/post-media-duration.mirror.test.ts pins together. Matches moments and story_segments.';
