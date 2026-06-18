-- M7 candidacy slice: dream_candidacies + identity-verified gate + candidacy-videos storage.
-- Backend spec 06 §2.4, 10 §4.1/§4.2. Fund = ZERO Aura (rule #1). ID gate is REAL (default-false).

-- ── 1. profiles.identity_verified — server-set ONLY (M9 Stripe Identity webhook) ──────────
alter table public.profiles
  add column identity_verified boolean not null default false;

comment on column public.profiles.identity_verified is
  'Set ONLY by the M9 Stripe Identity webhook (service_role). Client-unwritable: table UPDATE/INSERT revoked from authenticated, re-granted per-column excluding this. Gates dream_candidacies insert (06 §2.4, PRD §4.11).';

-- Lock the column from client writes. Table-level UPDATE/INSERT imply all columns (the hosted
-- ALTER DEFAULT PRIVILEGES grants them), so we drop them and re-grant per-column — re-granting
-- EVERY existing user-editable profiles column EXCEPT identity_verified (the public-handle-ssr
-- column-grant precedent). Confirmed column set: id, handle, bio, locale, visibility,
-- identity_tags, seeking, created_at, updated_at (init_profiles + onboarding_identity).
revoke update on table public.profiles from authenticated;
grant update (handle, bio, locale, visibility, identity_tags, seeking, updated_at)
  on table public.profiles to authenticated;
-- authenticated holds table-level INSERT on profiles (hosted default-priv) — lock it the same way.
-- (Onboarding writes via the handle_new_user DEFINER trigger, but the client insert grant exists.)
revoke insert on table public.profiles from authenticated;
grant insert (id, handle, bio, locale, visibility, identity_tags, seeking)
  on table public.profiles to authenticated;
-- service_role keeps `grant all` (set at table creation) — the webhook writes via it.

-- ── 2. identity-verified gate helper (00 §5 definer discipline) ───────────────────────────
create function public.is_identity_verified(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select p.identity_verified from public.profiles p where p.id = uid), false);
$$;
comment on function public.is_identity_verified(uuid) is
  'Reads profiles.identity_verified under definer rights so the candidacy INSERT WITH CHECK can gate on it without exposing the column cross-RLS. Never reads user_metadata (rule #2).';
revoke execute on function public.is_identity_verified(uuid) from public, anon;
grant execute on function public.is_identity_verified(uuid) to authenticated;

-- ── 3. dream_candidacies (GATED) — 06 §2.4 ────────────────────────────────────────────────
create table public.dream_candidacies (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.fund_editions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  story text not null check (char_length(story) between 1 and 4000),
  goal text not null check (char_length(goal) between 1 and 2000),
  impact text not null check (char_length(impact) between 1 and 2000),
  video_url text not null,
  plan text not null check (char_length(plan) between 1 and 4000),
  status text not null default 'submitted'
    check (status in ('submitted','screening','shortlisted','rejected','winner')),
  city text,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.dream_candidacies is
  'A member''s Dream Fund application. Author CRUD while submitted; accepted are public to members. Status transitions service-role/ethics only. Insert requires identity_verified (PRD §4.11). Zero Aura (rule #1).';

create unique index dream_candidacies_one_per_edition
  on public.dream_candidacies (edition_id, profile_id) where deleted_at is null;
create index dream_candidacies_list_feed
  on public.dream_candidacies (edition_id, created_at desc, id desc)
  where deleted_at is null and status in ('submitted','screening','shortlisted','winner');

create trigger dream_candidacies_touch_updated_at
  before update on public.dream_candidacies
  for each row execute function public.touch_updated_at();

revoke all on table public.dream_candidacies from anon;
grant select, insert, update on table public.dream_candidacies to authenticated;
grant all on table public.dream_candidacies to service_role;

alter table public.dream_candidacies enable row level security;

-- READ: own (any status, incl. rejected) + accepted/public ones for all members.
create policy "dream_candidacies_select_visible"
  on public.dream_candidacies for select
  to authenticated
  using (
    deleted_at is null
    and (
      (select auth.uid()) = profile_id
      or status in ('submitted','screening','shortlisted','winner')
    )
  );

-- INSERT: own row, identity-verified, status pinned to 'submitted'.
create policy "dream_candidacies_insert_own_verified"
  on public.dream_candidacies for insert
  to authenticated
  with check (
    (select auth.uid()) = profile_id
    and status = 'submitted'
    and public.is_identity_verified((select auth.uid()))
  );

-- UPDATE: own row, only while still 'submitted', status pinned both sides.
create policy "dream_candidacies_update_own_submitted"
  on public.dream_candidacies for update
  to authenticated
  using ((select auth.uid()) = profile_id and status = 'submitted')
  with check ((select auth.uid()) = profile_id and status = 'submitted');
-- no delete policy: withdraw = service-role soft-delete; erasure via GDPR job.

-- ── 4. fund_editions.winner_candidacy_id FK (forward ref resolved now) — 06 §2.1 ───────────
alter table public.fund_editions
  add constraint fund_editions_winner_candidacy_fk
  foreign key (winner_candidacy_id) references public.dream_candidacies (id) on delete set null;

-- ── 5. candidacy window helper (storage read gate) — 10 §4.2 ──────────────────────────────
-- Backend spec names it athanor.fund_edition_open(); the athanor schema is not created in
-- this codebase (shared predicates inlined / deferred), so it lives in public, like other
-- inlined helpers. Members may read candidacy videos while a candidacy window is open.
create function public.fund_edition_open()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.fund_editions
    where candidacy_window_open = true and phase <> 'closed'
  );
$$;
comment on function public.fund_edition_open() is
  'True while any fund edition has its candidacy window open. Gates candidacy-videos bucket reads (10 §4.2).';
revoke execute on function public.fund_edition_open() from public, anon;
grant execute on function public.fund_edition_open() to authenticated;

-- ── 6. candidacy-videos Storage bucket + RLS — 10 §4.1/§4.2 ────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidacy-videos', 'candidacy-videos', false, 209715200, array['video/mp4'])
on conflict (id) do nothing;

-- WRITE: owner only — first path segment must equal the caller's uid (INSERT+UPDATE+DELETE = upsert).
create policy "candidacy_videos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidacy-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "candidacy_videos_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'candidacy-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'candidacy-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "candidacy_videos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'candidacy-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- READ: members, gated to an open candidacy window.
create policy "candidacy_videos_select_members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'candidacy-videos'
    and public.fund_edition_open()
  );
