-- moments — a person's personal "Momenti" gallery (PRD §4, M1 frame shipped; live here in M3).
-- Bytes live in the moments Storage bucket; this row is the descriptor. Owner is the only
-- writer; members read (Profilo + Person Detail), mirroring posts. Per-profile momenti
-- visibility gating is deferred to M9 (no blocks/visibility predicate yet). Soft-delete.

create type public.moment_kind as enum ('photo', 'video');

create table public.moments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  kind         public.moment_kind not null,
  media_path   text not null,
  thumb_path   text,                                                    -- nullable: video poster, generated after upload
  caption      text check (caption is null or char_length(caption) <= 280),
  duration_s   int check (duration_s is null or duration_s between 0 and 60),  -- moments are short clips ≤60s (PRD §4)
  width        int check (width  is null or width  > 0),
  height       int check (height is null or height > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.moments is
  'A personal Momento (PRD §4, M1 frame; live M3). Bytes in Storage bucket moments; this row is the descriptor. Owner-write; members read (per-profile momenti visibility deferred to M9). EXIF/GPS stripped client-side before upload (resilience §7.2).';

create trigger moments_touch_updated_at
  before update on public.moments
  for each row execute function public.touch_updated_at();

-- keyset cursor (created_at desc, id desc); owner-scoped gallery. Rule #9.
create index moments_owner on public.moments (owner_id, created_at desc, id desc) where deleted_at is null;

revoke all on table public.moments from anon;
grant select, insert, update on table public.moments to authenticated;  -- delete = soft-delete via update
grant all on table public.moments to service_role;

alter table public.moments enable row level security;

-- TODO(M9): mirror any per-profile momenti visibility / blocks predicate here (deferred — soft-deleted hidden from all today).
create policy "moments_select_authenticated"
  on public.moments for select
  to authenticated
  using (deleted_at is null);

create policy "moments_insert_own"
  on public.moments for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "moments_update_own"
  on public.moments for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
