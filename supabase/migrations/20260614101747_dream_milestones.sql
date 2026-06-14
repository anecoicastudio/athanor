-- dream_milestones — tappe, the discrete help-able needs of a dream (PRD §4.3, M2).
-- Owner CRUD; others read per the parent dream's visibility. status→done emits the
-- +10 own-milestone domain event (engine, backend 07 / M6 — no client Aura write).

create type public.milestone_status as enum ('open', 'in_progress', 'done');

create table public.dream_milestones (
  id uuid primary key default gen_random_uuid(),
  dream_id uuid not null references public.dreams (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  status public.milestone_status not null default 'open',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.dream_milestones is
  'Tappe — discrete help-able needs of a dream (PRD §4.3). Owner CRUD; others read per parent dream visibility. status→done emits the +10 own-milestone event (engine, 07).';
comment on column public.dream_milestones.body is 'The need, owner''s words («un logo», «un mentor»).';
comment on column public.dream_milestones.position is 'Manual ordering within a dream (client sets; small N).';

create trigger dream_milestones_touch_updated_at
  before update on public.dream_milestones
  for each row execute function public.touch_updated_at();

create index dream_milestones_by_dream
  on public.dream_milestones (dream_id, position, created_at, id)
  where deleted_at is null;

-- ownership is one hop away (dream_milestones → dreams → profiles.id); helper keeps policies readable
create function public.owns_dream(p_dream_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.dreams d
    where d.id = p_dream_id
      and d.profile_id = (select auth.uid())
  );
$$;
revoke execute on function public.owns_dream(uuid) from public, anon;
grant execute on function public.owns_dream(uuid) to authenticated;

-- privileges
revoke all on table public.dream_milestones from anon;
grant select on table public.dream_milestones to anon;            -- public @handle dream steps (web slice)
grant select, insert, update on table public.dream_milestones to authenticated;
grant all on table public.dream_milestones to service_role;

alter table public.dream_milestones enable row level security;

-- SELECT (authenticated): members read tappe of any dream they can read (mirrors dreams members-wide)
create policy "dream_milestones_select_authenticated"
  on public.dream_milestones for select
  to authenticated
  using (deleted_at is null);

-- SELECT (anon): only tappe whose parent dream is active + public
create policy "dream_milestones_select_anon_public"
  on public.dream_milestones for select
  to anon
  using (
    deleted_at is null
    and exists (
      select 1 from public.dreams d
      join public.profiles p on p.id = d.profile_id
      where d.id = dream_milestones.dream_id
        and d.deleted_at is null and d.status = 'active'
        and coalesce(p.visibility ->> 'dream', 'members') = 'public'
    )
  );

-- INSERT: only the dream owner adds tappe to their own dream
create policy "dream_milestones_insert_own"
  on public.dream_milestones for insert
  to authenticated
  with check (public.owns_dream(dream_id));

-- UPDATE: only the dream owner (mark done/in_progress, reorder, soft-delete) — USING + WITH CHECK
create policy "dream_milestones_update_own"
  on public.dream_milestones for update
  to authenticated
  using (public.owns_dream(dream_id))
  with check (public.owns_dream(dream_id));

-- no delete policy: soft-delete is an owner update(deleted_at); hard erase = GDPR job (M9)
