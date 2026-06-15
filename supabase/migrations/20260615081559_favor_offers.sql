-- favor_offers — Passa il Favore (M3, PRD §4 / frontend 03 §3.6.1). Directed pay-it-forward:
-- actor (helper) inserts; target (helped) reads own incoming. Feeds the Collaboratore star
-- (engine, backend 07 / M6 — NO client Aura write). NO money.

create table public.favor_offers (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete cascade,    -- helper
  target_id uuid not null references public.profiles (id) on delete cascade,   -- helped
  need text not null check (char_length(btrim(need)) between 1 and 280),
  need_milestone_id uuid references public.dream_milestones (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (actor_id <> target_id),                       -- can't favor yourself
  unique (actor_id, target_id, need)                   -- one favor per (helper, helped, need)
);

comment on table public.favor_offers is
  'Passa il Favore (M3) — directed pay-it-forward. actor helps target asking nothing back. Emits the Collaboratore event (engine, 07). NO money.';

create trigger favor_offers_touch_updated_at
  before update on public.favor_offers
  for each row execute function public.touch_updated_at();

create index favor_offers_incoming
  on public.favor_offers (target_id, created_at desc, id desc) where deleted_at is null;
create index favor_offers_outgoing
  on public.favor_offers (actor_id, created_at desc, id desc) where deleted_at is null;

-- privileges
revoke all on table public.favor_offers from anon;                -- private
grant select, insert, update on table public.favor_offers to authenticated;
grant all on table public.favor_offers to service_role;

alter table public.favor_offers enable row level security;

-- SELECT: actor sees own outgoing; target sees own incoming
create policy "favor_offers_select_party"
  on public.favor_offers for select
  to authenticated
  using (
    deleted_at is null
    and ((select auth.uid()) = actor_id or (select auth.uid()) = target_id)
  );

-- INSERT: only the actor, as themselves (with-check duplicates the table CHECK for defense-in-depth)
create policy "favor_offers_insert_actor"
  on public.favor_offers for insert
  to authenticated
  with check ((select auth.uid()) = actor_id and actor_id <> target_id);

-- UPDATE: actor may soft-delete (withdraw) own favor — USING + WITH CHECK
create policy "favor_offers_update_actor"
  on public.favor_offers for update
  to authenticated
  using ((select auth.uid()) = actor_id)
  with check ((select auth.uid()) = actor_id);

-- no delete policy: soft-delete via update(deleted_at); GDPR hard-erase service-side

-- favor_needs — read-model of people with an OPEN need (frontend 03 §3.6.1 "FAVOR_NEEDS").
-- Derived from open dream_milestones of OTHER members; excludes needs I've already favored.
-- security_invoker = the caller's RLS on dream_milestones/dreams/profiles/favor_offers applies
-- (profiles/dreams/dream_milestones are members-readable; favor_offers is party-only so the
-- NOT EXISTS only sees MY rows).
create view public.favor_needs
with (security_invoker = true)
as
  select
    m.id          as need_milestone_id,
    m.body        as need,
    m.created_at  as need_created_at,
    d.profile_id  as target_id,
    p.handle      as target_handle
  from public.dream_milestones m
  join public.dreams d   on d.id = m.dream_id  and d.deleted_at is null and d.status = 'active'
  join public.profiles p on p.id = d.profile_id
  where m.deleted_at is null
    and m.status = 'open'
    and d.profile_id <> (select auth.uid())               -- not my own needs
    and not exists (                                       -- not already favored by me on this need
      select 1 from public.favor_offers fo
      where fo.actor_id = (select auth.uid())
        and fo.need_milestone_id = m.id
        and fo.deleted_at is null
    );

comment on view public.favor_needs is
  'Open needs for Passa il Favore (M3): open dream_milestones of other members, minus needs the viewer already favored. security_invoker — underlying RLS applies.';

revoke all on public.favor_needs from anon;
grant select on public.favor_needs to authenticated;
