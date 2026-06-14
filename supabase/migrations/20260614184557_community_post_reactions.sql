-- post_reactions — the single ✦ "light a star" (PRD §4.5, M3). One per (post, person).
-- ANTI-VANITY (CLAUDE.md #3): a person SELECTs only their OWN reaction row, so a
-- non-author can never count another post's reactions at the table level. The true
-- total is exposed to the post AUTHOR ONLY via post_reaction_count() (SECURITY DEFINER,
-- author-gated). Inserting a ✦ emits the M6 domain event (backend 07); never writes aura
-- (rule #1). Toggle = insert/delete (no update, no soft-delete, no mutable state).

create table public.post_reactions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  person_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.post_reactions is
  'A single ✦ — light a star. One per (post, person). ANTI-VANITY: a person reads only their OWN row; the aggregate is author-only via post_reaction_count() (CLAUDE.md #3, PRD §4.5). Emits the M6 domain event; never writes aura.';

create unique index post_reactions_unique on public.post_reactions (post_id, person_id);
create index post_reactions_post on public.post_reactions (post_id);   -- the author count fn scans by post

revoke all on table public.post_reactions from anon;
grant select, insert, delete on table public.post_reactions to authenticated;   -- toggle = insert/delete; no update
grant all on table public.post_reactions to service_role;

alter table public.post_reactions enable row level security;

-- SELECT: a person sees ONLY their own reaction row (drives lit/unlit; makes the
-- aggregate uncomputable by a non-author — count over a post is at most 1 for them).
create policy "post_reactions_select_own"
  on public.post_reactions for select
  to authenticated
  using ((select auth.uid()) = person_id);

-- INSERT: own reaction, on a live post, and NOT your own post (no self-✦).
create policy "post_reactions_insert_own"
  on public.post_reactions for insert
  to authenticated
  with check (
    (select auth.uid()) = person_id
    and exists (
      select 1 from public.posts p
      where p.id = post_reactions.post_id
        and p.deleted_at is null
        and p.author_id <> person_id
    )
  );

-- DELETE: re-tap removes your own ✦.
create policy "post_reactions_delete_own"
  on public.post_reactions for delete
  to authenticated
  using ((select auth.uid()) = person_id);
-- no update policy: a reaction has no mutable state

-- Author-only aggregate. SECURITY DEFINER (reads rows the caller doesn't own), so:
-- locked search_path, execute revoked from public/anon, and an explicit author check
-- in the body. Returns the bare count to the author; 0 (NOT an error — no existence
-- oracle) to everyone else.
create function public.post_reaction_count(p_post_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_count  integer;
begin
  select author_id into v_author from public.posts where id = p_post_id and deleted_at is null;
  if v_author is null or v_author <> (select auth.uid()) then
    return 0;                                               -- non-author (or missing post) learns nothing
  end if;
  select count(*) into v_count from public.post_reactions where post_id = p_post_id;
  return v_count;
end;
$$;

comment on function public.post_reaction_count(uuid) is
  'Author-only ✦ count for a post. Returns 0 to non-authors (anti-vanity, CLAUDE.md #3). SECURITY DEFINER + locked search_path + in-body author check.';

revoke execute on function public.post_reaction_count(uuid) from public, anon;
grant   execute on function public.post_reaction_count(uuid) to authenticated;
