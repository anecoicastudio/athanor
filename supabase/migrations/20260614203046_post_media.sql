-- post_media — media attached to a community post (PRD §4.5, M3). Bytes live in the
-- post-media Storage bucket; this row is the descriptor. The post AUTHOR is the only
-- writer; reads follow the parent post (members-wide, live). No anon, no visibility/
-- blocks predicate yet (M9). post_type already declared full in feed_posts → no enum-alter.

create type public.media_kind as enum ('image', 'video', 'audio');

create table public.post_media (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts (id) on delete cascade,
  kind         public.media_kind not null,
  storage_path text not null,
  duration_s   int check (duration_s is null or duration_s between 0 and 1200),
  width        int check (width  is null or width  > 0),
  height       int check (height is null or height > 0),
  position     int not null default 0 check (position >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.post_media is
  'Media attached to a post (PRD §4.5, M3). Bytes in Storage bucket post-media; this row is the descriptor. Post author is the only writer; reads follow the parent post (members-wide, live). EXIF/GPS stripped client-side before upload (resilience §7.2).';

create trigger post_media_touch_updated_at
  before update on public.post_media
  for each row execute function public.touch_updated_at();

-- the unique index also serves every (post_id[, position]) read path — no separate plain index.
create unique index post_media_post_position on public.post_media (post_id, position);

revoke all on table public.post_media from anon;
grant select, insert, update, delete on table public.post_media to authenticated;
grant all on table public.post_media to service_role;

alter table public.post_media enable row level security;

-- TODO(M9): mirror any visibility/blocks predicate added to posts_select_authenticated.
create policy "post_media_select_authenticated"
  on public.post_media for select
  to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_media.post_id and p.deleted_at is null
  ));

create policy "post_media_insert_post_author"
  on public.post_media for insert
  to authenticated
  with check (exists (
    select 1 from public.posts p
    where p.id = post_media.post_id and p.author_id = (select auth.uid())
  ));

create policy "post_media_update_post_author"
  on public.post_media for update
  to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_media.post_id and p.author_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.posts p
    where p.id = post_media.post_id and p.author_id = (select auth.uid())
  ));

create policy "post_media_delete_post_author"
  on public.post_media for delete
  to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_media.post_id and p.author_id = (select auth.uid())
  ));

alter publication supabase_realtime add table public.post_media;
