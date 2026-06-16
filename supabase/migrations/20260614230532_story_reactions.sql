-- story_reactions — a ✦ "celebrate this step" (PRD §4.5, M3). One per (segment, person).
-- ANTI-VANITY (CLAUDE.md #3): a person SELECTs only their OWN row, so a non-owner can never
-- count a segment's celebrations at the table level. The true total is exposed to the segment
-- AUTHOR ONLY via story_reaction_count() (SECURITY DEFINER, author-gated). Inserting a ✦ emits
-- the M6 domain event (backend 07, +4); never writes aura (rule #1). Toggle = insert/delete.

create table public.story_reactions (
  id         uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.story_segments (id) on delete cascade,
  person_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.story_reactions is
  'A ✦ — celebrate a growth step. One per (segment, person). ANTI-VANITY: person reads only their own; the celebration count is owner-only via story_reaction_count() (CLAUDE.md #3). Emits a domain event for the M6 score-engine (+4); never writes aura.';

create unique index story_reactions_unique on public.story_reactions (segment_id, person_id);
create index story_reactions_segment on public.story_reactions (segment_id);

revoke all on table public.story_reactions from anon;
grant select, insert, delete on table public.story_reactions to authenticated;  -- toggle = insert/delete
grant all on table public.story_reactions to service_role;

alter table public.story_reactions enable row level security;

-- SELECT: a person sees ONLY their own reaction row (drives lit/unlit; makes the aggregate
-- uncomputable by a non-owner).
create policy "story_reactions_select_own"
  on public.story_reactions for select
  to authenticated
  using ((select auth.uid()) = person_id);

-- INSERT: own reaction, on a live-or-pinned segment.
create policy "story_reactions_insert_own"
  on public.story_reactions for insert
  to authenticated
  with check (
    (select auth.uid()) = person_id
    and exists (
      select 1 from public.story_segments s
      where s.id = story_reactions.segment_id
        and s.deleted_at is null
        and (s.expires_at > now() or s.pinned)
    )
  );

-- DELETE: re-tap removes your own ✦.
create policy "story_reactions_delete_own"
  on public.story_reactions for delete
  to authenticated
  using ((select auth.uid()) = person_id);
-- no update policy: a reaction has no mutable state

-- Author-only celebration count (same SECURITY DEFINER discipline as post_reaction_count):
-- locked search_path, execute revoked from public/anon, explicit author check in the body.
create function public.story_reaction_count(p_segment_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  select author_id into v_owner from public.story_segments where id = p_segment_id and deleted_at is null;
  if v_owner is null or v_owner <> (select auth.uid()) then
    return 0;                                               -- non-owner (or missing segment) learns nothing
  end if;
  select count(*) into v_count from public.story_reactions where segment_id = p_segment_id;
  return v_count;
end;
$$;

comment on function public.story_reaction_count(uuid) is
  'Owner-only ✦ celebration count for a story segment. Returns 0 to non-owners (anti-vanity, CLAUDE.md #3). SECURITY DEFINER + locked search_path + in-body author check.';

revoke execute on function public.story_reaction_count(uuid) from public, anon;
grant   execute on function public.story_reaction_count(uuid) to authenticated;
