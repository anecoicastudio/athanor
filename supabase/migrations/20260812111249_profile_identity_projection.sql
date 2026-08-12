-- #76 — project display_name and avatar_path through the four accessors that hand a member's
-- identity to another member.
--
-- 20260811074859 put both columns in the DIRECT grant tier, so any plain `select` on profiles
-- already carries them and five of the app's avatar surfaces (chat, connections requests,
-- momenti deck, story rail, blocked list) need no SQL at all — just wider embeds client-side.
--
-- These four are the exceptions, and they are exceptions for the same reason: each projects a
-- FIXED column list, so a column the caller is allowed to read is still invisible if the
-- projection does not name it. Between them they feed the third-person profile hero, the six
-- PostAuthorRow mounts, the event attendee stack, the incoming-favor rows, the «Ti potrebbe
-- interessare» suggestion, the connections list, and the Passa il Favore nudge — i.e. most of
-- the render sites #76 has to reach.
--
-- WHY drop + create RATHER THAN create or replace: Postgres refuses to change a function's
-- OUT-parameter list through `create or replace function` (42P13, "cannot change return type of
-- existing function"), and every one of these widens a `returns table (...)`. Dropping also
-- drops the function's ACL, so each block re-issues its own revoke/grant pair — omitting that
-- would leave the accessor executable by `public`.
--
-- NO VISIBILITY GATE on either column, and that is deliberate rather than an oversight — see
-- 20260811074859's header. `athanor.field_visible` defaults an absent key to 'members', no
-- profile carries a 'name' or 'avatar' key, and wrapping them in `case when field_visible(...)`
-- would compute the same answer at a cost. Per-field privacy for a name or a face is a product
-- decision that needs a visibility key first.

-- ── 1. get_person_profile — the third-person hero, PostAuthorRow, AttendeeStack ────────────
-- Body is otherwise byte-for-byte 20260807170813's: the three visibility-gated fields keep
-- their `case when athanor.field_visible(...)` wrappers, the caller must be signed in, and
-- athanor.not_blocked still hides a blocked pair in both directions.
drop function if exists public.get_person_profile(uuid);

create function public.get_person_profile(p_profile_id uuid)
returns table (
  id uuid,
  handle text,
  display_name text,
  avatar_path text,
  bio text,
  identity_tags text[],
  seeking text[],
  founding_member boolean,
  identity_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.handle,
    p.display_name,
    p.avatar_path,
    case when athanor.field_visible(p.id, 'bio') then p.bio end,
    case when athanor.field_visible(p.id, 'identity_tags') then p.identity_tags end,
    case when athanor.field_visible(p.id, 'seeking') then p.seeking end,
    p.founding_member,
    p.identity_verified
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

comment on function public.get_person_profile(uuid) is
  'Third-person profile projection. bio/identity_tags/seeking arrive NULL when the owner hid '
  'them (M10 visibility); display_name and avatar_path are identity surface like handle and are '
  'never masked here (#76). Signed-in callers only, blocked pairs excluded both ways.';

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;

-- ── 2. get_momenti_suggestion — «Ti potrebbe interessare» ──────────────────────────────────
-- Body unchanged from 20260808041335, including the erratum it records about a both-tags-private
-- member still receiving a deck of their own.
drop function if exists public.get_momenti_suggestion(uuid[]);

create function public.get_momenti_suggestion(p_exclude uuid[] default '{}')
returns table (candidate_id uuid, handle text, display_name text, avatar_path text, dream_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.handle, p.display_name, p.avatar_path, d.text
    from public.profiles p
    join lateral (
      select dd.text, dd.created_at
        from public.dreams dd
       where dd.profile_id = p.id
         and dd.status = 'active'
         and dd.deleted_at is null
       order by dd.created_at desc
       limit 1
    ) d on true
   where (select auth.uid()) is not null
     and p.id <> (select auth.uid())
     -- NOT EXISTS over a clamped array: NULL-safe, and bounded work per call.
     and not exists (
       select 1 from unnest((coalesce(p_exclude, '{}'::uuid[]))[1:50]) x where x = p.id
     )
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
   order by d.created_at desc
   limit 1;
$$;

comment on function public.get_momenti_suggestion(uuid[]) is
  'Curated-lite «Ti potrebbe interessare» peer: the most recently written active dream, '
  'excluding the caller, today''s deck, blocked peers, and members who hid BOTH tag fields. '
  'Ordered by dream recency, NOT affinity — no affinity is computed here (a suggestions table '
  'is deferred since M5), which is why the UI chip says «Sogno nuovo». '
  'DEFINER because profiles.visibility is not readable by authenticated (M10 column grant). '
  'Carries the peer''s name and avatar since #76.';

revoke execute on function public.get_momenti_suggestion(uuid[]) from public, anon;
grant execute on function public.get_momenti_suggestion(uuid[]) to authenticated;

-- ── 3. search_connections — the Connessioni list and the new-message picker ────────────────
-- Still SECURITY INVOKER: the caller's own RLS on `connections` is what limits the rows, and the
-- two new columns are readable directly by `authenticated` (20260811074859), so nothing here
-- needs elevating. The search predicate keeps matching on handle ALONE — a name is not unique,
-- not stable, and not what a member types to find someone; keyset order on (created_at, id) is
-- likewise untouched (rule #9).
drop function if exists public.search_connections(text, timestamptz, uuid, int);

create function public.search_connections(
  p_query              text default '',
  p_cursor_created_at  timestamptz default null,
  p_cursor_id          uuid default null,
  p_limit              int default 20
)
returns table (
  connection_id uuid,
  peer_id uuid,
  peer_handle text,
  peer_display_name text,
  peer_avatar_path text,
  created_at timestamptz
)
language sql security invoker set search_path = '' stable as $$
  select
    c.id as connection_id,
    case when c.profile_a = (select auth.uid()) then c.profile_b else c.profile_a end as peer_id,
    p.handle as peer_handle,
    p.display_name as peer_display_name,
    p.avatar_path as peer_avatar_path,
    c.created_at
  from public.connections c
  join public.profiles p
    on p.id = (case when c.profile_a = (select auth.uid()) then c.profile_b else c.profile_a end)
  where (coalesce(p_query, '') = '' or p.handle ilike '%' || p_query || '%')
    and (
      p_cursor_created_at is null
      or c.created_at < p_cursor_created_at
      or (c.created_at = p_cursor_created_at and c.id < p_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.search_connections(text, timestamptz, uuid, int) is
  'Keyset-paginated connections list resolving the peer side of each row, with the peer''s '
  'identity surface (handle, name, avatar) since #76. Search still matches handle only.';

revoke execute on function public.search_connections(text, timestamptz, uuid, int) from public, anon;
grant  execute on function public.search_connections(text, timestamptz, uuid, int) to authenticated;

-- ── 4. search_all — the person arm of global search ───────────────────────────────────────
-- The polymorphic one. `title`/`subtitle` mean something different per entity type, so the two
-- new columns are person-only and NULL for a project or an event; the client renders an avatar
-- only on the person arm anyway. The three arms' predicates, the entitlement downgrade of the
-- advanced filters, the rank expression and the keyset are all unchanged from 20260807170813 —
-- only the projection is wider.
--
-- `avatar_path` here is still a private-bucket key: search returns the key, the client signs it
-- like every other avatar. Nothing in this function makes a face public.
drop function if exists public.search_all(text, text, real, uuid, integer, integer, text, text);

create function public.search_all(
  q            text,
  scope        text    default 'all',
  cursor_rank  real    default null,
  cursor_id    uuid    default null,
  page_size    integer default 20,
  f_aura_min   integer default null,
  f_city       text    default null,
  f_star       text    default null
)
returns table (
  entity_type  text,
  id           uuid,
  title        text,
  subtitle     text,
  display_name text,
  avatar_path  text,
  rank         real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  member boolean;
  needle text := public.f_unaccent(coalesce(q, ''));
begin
  if length(btrim(needle)) < 2 then
    return;
  end if;

  select coalesce(bool_or(e.advanced_filters), false) into member
  from public.entitlements e;
  if not member then
    f_aura_min := null; f_city := null; f_star := null;
  end if;

  return query
  with hits as (
    -- PEOPLE — visibility-filtered document via DEFINER helper (no index; accepted, see 20260807170813)
    select 'person'::text as entity_type, p.id,
           p.handle as title,
           left(coalesce(athanor.visible_bio(p.id), ''), 140) as subtitle,
           p.display_name,
           p.avatar_path,
           extensions.word_similarity(needle, athanor.profile_search_text(p.id)) as rank
    from public.profiles p
    where scope in ('all','people')
      and needle operator(extensions.<%) athanor.profile_search_text(p.id)
      and (f_aura_min is null
           or coalesce((select s.score from public.aura_scores s where s.profile_id = p.id), 0) >= f_aura_min)
      and (f_star is null
           or exists (select 1 from public.stars st
                       where st.profile_id = p.id and st.star_id = f_star and st.granted_at is not null))
      and (f_city is null or athanor.visible_bio(p.id) ilike '%' || f_city || '%')

    union all
    -- PROJECTS — a project has no face; both identity columns are NULL on this arm.
    select 'project', pr.id, pr.title,
           pr.category::text,
           null::text, null::text,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,'')))
    from public.projects pr
    where scope in ('all','projects')
      and pr.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,''))

    union all
    -- EVENTS — likewise.
    select 'event', ev.id, ev.title,
           coalesce(ev.venue,'') ,
           null::text, null::text,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,'')))
    from public.events ev
    where scope in ('all','events')
      and ev.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,''))
      and (f_city is null or ev.venue ilike '%' || f_city || '%')
  )
  select h.entity_type, h.id, h.title, h.subtitle, h.display_name, h.avatar_path, h.rank
  from hits h
  where cursor_rank is null
     or (h.rank, h.id) < (cursor_rank, cursor_id)
  order by h.rank desc, h.id desc
  limit least(coalesce(page_size, 20), 50);
end;
$$;

comment on function public.search_all(text, text, real, uuid, integer, integer, text, text) is
  'Global search across people, projects and events. display_name/avatar_path are person-arm '
  'only and NULL elsewhere (#76); avatar_path is a private-bucket key the client signs.';

revoke execute on function public.search_all(text, text, real, uuid, integer, integer, text, text) from public, anon;
grant  execute on function public.search_all(text, text, real, uuid, integer, integer, text, text) to authenticated;

-- ── 5. favor_needs — the Passa il Favore nudge and list ────────────────────────────────────
-- A genuine `create or replace view`: the two columns append after the existing five, which is
-- the one shape Postgres accepts without a drop. `security_invoker` is repeated because the
-- option is part of the definition, not a property that survives on its own — and it is what
-- makes the caller's RLS apply. Both new columns sit in the direct grant tier, so an invoker
-- view can read them.
create or replace view public.favor_needs
with (security_invoker = true)
as
  select
    m.id          as need_milestone_id,
    m.body        as need,
    m.created_at  as need_created_at,
    d.profile_id  as target_id,
    p.handle      as target_handle,
    p.display_name as target_display_name,
    p.avatar_path  as target_avatar_path
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
  'Open needs for Passa il Favore (M3): open dream_milestones of other members, minus needs the '
  'viewer already favored. Carries the target''s name and avatar since #76. security_invoker — '
  'underlying RLS applies.';

revoke all on public.favor_needs from anon;
grant select on public.favor_needs to authenticated;
