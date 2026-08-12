-- #282: the ballot rendered every candidate as the same grey 16:9 rectangle. dream_candidacies
-- had no thumb-shaped column at all, so #131 (which gave video *Momenti* a poster) could not
-- reach this surface — that was moments.thumb_path, a different column on a different table.

alter table public.dream_candidacies add column if not exists thumb_path text;

comment on column public.dream_candidacies.thumb_path is
  'Poster frame for video_url, a storage key in candidacy-videos ({uid}/{id}-thumb.jpg). Nullable: extraction is best-effort client-side and a row written before posters existed has no recoverable first frame. Mirrors moments.thumb_path (#282). NB the sibling video_url also holds a path, not a URL.';

-- The bucket accepted video/mp4 only (20260617225450_m7_candidacy.sql:137), so a poster written
-- beside its video was rejected on upload. Same folder, same owner-write policies, same
-- members-read gate — the four candidacy_videos_* policies key on bucket_id plus the first path
-- segment and need no change.
update storage.buckets
   set allowed_mime_types = array['video/mp4','image/jpeg']
 where id = 'candidacy-videos';

-- thumb_path is appended LAST on purpose: `create or replace view` may only add columns, never
-- reorder or retype existing ones. Putting it beside video_url, where it reads better, would
-- force drop+create — which discards the `revoke all from anon` / `grant select to authenticated`
-- pair and the view comment. security_invoker must be restated or the view silently becomes a
-- definer view and stops composing with dream_candidacies RLS.
create or replace view public.fund_candidate_cards
with (security_invoker = true)
as
  select
    c.id          as candidacy_id,
    c.edition_id,
    c.profile_id,
    p.handle,
    d.text        as title,
    c.city,
    c.category,
    c.status,
    c.video_url,
    c.created_at,
    c.thumb_path
  from public.dream_candidacies c
  join public.profiles p on p.id = c.profile_id
  left join public.dreams d
    on d.profile_id = c.profile_id and d.status = 'active' and d.deleted_at is null
  where c.deleted_at is null;
