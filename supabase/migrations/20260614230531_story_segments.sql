-- story_segments — a 24h growth-step "story" (PRD §4.5, M3). expires_at = created_at + 24h.
-- Pinned step segments ("un passo del percorso" pinned-to-journey) survive the 24h TTL and
-- are retained for the profile journey (M3 keeps the pin action; the journey *display* surface
-- is deferred — see plan deferrals). Rail/viewer show author_id with expires_at > now() OR pinned.
-- Owner CRUD (soft-delete via update); members read. Bytes live in the story-segments bucket;
-- this row is the descriptor. EXIF/GPS stripped CLIENT-SIDE before upload (resilience §7.2);
-- server-side strip = deferred defense-in-depth (launch-blocker TODO, inherited from post-media).

create type public.story_kind as enum ('photo', 'video');

create table public.story_segments (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles (id) on delete cascade,
  kind         public.story_kind not null,
  storage_path text not null,                                              -- object key in the story-segments bucket
  duration_s   int  check (duration_s is null or duration_s between 0 and 60),
  caption      text check (caption is null or char_length(caption) <= 280),
  is_step      boolean not null default false,                            -- «un passo del percorso»
  pinned       boolean not null default false,                            -- pinned-to-journey survives the 24h TTL
  expires_at   timestamptz not null default (now() + interval '24 hours'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.story_segments is
  'A 24h growth-step segment (story). expires_at = created_at + 24h; pinned step segments survive expiry and are retained on the journey (PRD §4.5). Rail shows author_id with expires_at > now() OR pinned. Author CRUD; members read. EXIF/GPS stripped client-side before upload.';

create trigger story_segments_touch_updated_at
  before update on public.story_segments
  for each row execute function public.touch_updated_at();

-- rail / viewer: live OR pinned, newest first (keyset, rule #9). Partial indexes on each predicate.
create index story_segments_live on public.story_segments (author_id, created_at desc, id desc)
  where deleted_at is null and pinned = false;
create index story_segments_expiry on public.story_segments (expires_at)
  where deleted_at is null and pinned = false;
create index story_segments_pinned on public.story_segments (author_id, created_at desc)
  where deleted_at is null and pinned = true;

revoke all on table public.story_segments from anon;
grant select, insert, update on table public.story_segments to authenticated;  -- delete = soft-delete via update
grant all on table public.story_segments to service_role;

alter table public.story_segments enable row level security;

-- members read live-or-pinned segments; expired-and-unpinned are invisible (TTL at query time,
-- belt-and-braces with the cron prune). TODO(M9): add is_visible_to_me / not_blocked here.
create policy "story_segments_select_live"
  on public.story_segments for select
  to authenticated
  using (
    deleted_at is null
    and (expires_at > now() or pinned)
  );

create policy "story_segments_insert_own"
  on public.story_segments for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

create policy "story_segments_update_own"
  on public.story_segments for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);             -- pin/unpin + soft-delete = update; author-only
-- no delete policy: author soft-deletes; expired unpinned segments pruned by cron

-- realtime: the rail subscribes to new segments (frontend §5). Mirror posts.
alter publication supabase_realtime add table public.story_segments;
