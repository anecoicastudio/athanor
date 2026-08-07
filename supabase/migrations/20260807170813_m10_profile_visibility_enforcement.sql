-- M10 — per-field profile visibility, enforced (PRD §4.2; the M1-deferred enforcement).
--
-- Before this migration the authenticated path never honored profiles.visibility:
-- any non-blocked member could read every column of every profile (select('*') +
-- table-level grant), search_all returned private bios as snippets and matched on
-- private tags, and run_momenti_matcher surfaced private tags as match reasons.
-- Canonical default for an ABSENT visibility key is 'members' (matches the anon
-- readers in 20260614144747; the edit UI's 'public' default is fixed app-side in
-- the same change).
--
-- Design:
--   • Column-scope the authenticated SELECT grant on profiles to non-sensitive
--     columns. RLS stays row-level (not_blocked); columns are the leak surface.
--   • SECURITY DEFINER accessors project the sensitive columns back out under
--     visibility rules: get_person_profile (third-person), get_own_profile
--     (own full row — grants are role-wide, so own reads need a channel too).
--   • search_all stays SECURITY INVOKER; its person arm reads sensitive fields
--     only through DEFINER helpers (athanor.profile_search_text / visible_bio).
--     The trigram index on f_profile_search no longer serves the rewritten
--     match expression — accepted at launch scale; revisit with a
--     visibility-aware index expression if people-search slows.
--   • run_momenti_matcher hides the CANDIDATE's private tags from affinity and
--     reasons (the leak is revealing them to the recipient).
--   • dreams / dream_milestones authenticated SELECT policies gain the
--     visibility('dream') gate (absent key = members ⇒ behavior unchanged until
--     someone opts into 'private').
--
-- SECURITY DEFINER justification (00 §4.1): each function below must read
-- profiles columns that the calling role deliberately can no longer SELECT.
-- All are STABLE, search_path-locked, EXECUTE revoked from public/anon and
-- granted to authenticated only; every one re-checks auth.uid() + not_blocked.

-- ── 1. Visibility predicate ──────────────────────────────────────────────────

create function athanor.field_visible(p_owner uuid, p_field text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) = p_owner then true
    when (select auth.uid()) is not null then
      coalesce(
        (select p.visibility ->> p_field from public.profiles p where p.id = p_owner),
        'members'
      ) in ('public', 'members')
      and athanor.not_blocked(p_owner)
    else
      coalesce(
        (select p.visibility ->> p_field from public.profiles p where p.id = p_owner),
        'members'
      ) = 'public'
  end;
$$;

revoke execute on function athanor.field_visible(uuid, text) from public, anon;
grant execute on function athanor.field_visible(uuid, text) to authenticated;

-- ── 2. Column-scope the authenticated read on profiles ──────────────────────
-- Sensitive columns (bio, identity_tags, seeking, locale, visibility,
-- push_enabled, referral_code) are no longer directly selectable; every embed
-- join in the app needs only id + handle (+ the public badges).

revoke select on table public.profiles from authenticated;
grant select (id, handle, founding_member, identity_verified, created_at, updated_at)
  on table public.profiles to authenticated;

-- ── 3. Third-person profile accessor ─────────────────────────────────────────

create function public.get_person_profile(p_profile_id uuid)
returns table (
  id uuid,
  handle text,
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

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;

-- ── 4. Own full-row accessor ─────────────────────────────────────────────────

create function public.get_own_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.profiles where id = (select auth.uid());
$$;

revoke execute on function public.get_own_profile() from public, anon;
grant execute on function public.get_own_profile() to authenticated;

-- ── 5. DEFINER helpers for the (still-INVOKER) search person arm ────────────

-- Visibility-filtered search document: private fields simply vanish from the
-- matchable text. Handle always matches (it is the public identity).
create function athanor.profile_search_text(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.f_profile_search(
    p.handle,
    case when coalesce(p.visibility ->> 'bio', 'members') <> 'private' then p.bio end,
    case when coalesce(p.visibility ->> 'identity_tags', 'members') <> 'private'
         then p.identity_tags else '{}'::text[] end,
    case when coalesce(p.visibility ->> 'seeking', 'members') <> 'private'
         then p.seeking else '{}'::text[] end
  )
  from public.profiles p
  where p.id = p_id;
$$;

create function athanor.visible_bio(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when athanor.field_visible(p.id, 'bio') then p.bio end
  from public.profiles p
  where p.id = p_id;
$$;

revoke execute on function athanor.profile_search_text(uuid) from public, anon;
revoke execute on function athanor.visible_bio(uuid) from public, anon;
grant execute on function athanor.profile_search_text(uuid) to authenticated;
grant execute on function athanor.visible_bio(uuid) to authenticated;

-- ── 6. search_all: person arm goes through the helpers ──────────────────────
-- Signature unchanged. Only the people CTE arm differs from 20260619103142:
-- match + rank use athanor.profile_search_text (private fields unmatchable),
-- subtitle + weak city filter use athanor.visible_bio.

create or replace function public.search_all(
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
  entity_type text,
  id          uuid,
  title       text,
  subtitle    text,
  rank        real
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
    -- PEOPLE — visibility-filtered document via DEFINER helper (no index; accepted, see header)
    select 'person'::text as entity_type, p.id,
           p.handle as title,
           left(coalesce(athanor.visible_bio(p.id), ''), 140) as subtitle,
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
    -- PROJECTS (unchanged from 20260619103142)
    select 'project', pr.id, pr.title,
           pr.category::text,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,'')))
    from public.projects pr
    where scope in ('all','projects')
      and pr.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,''))

    union all
    -- EVENTS (unchanged from 20260619103142)
    select 'event', ev.id, ev.title,
           coalesce(ev.venue,'') ,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,'')))
    from public.events ev
    where scope in ('all','events')
      and ev.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,''))
      and (f_city is null or ev.venue ilike '%' || f_city || '%')
  )
  select h.entity_type, h.id, h.title, h.subtitle, h.rank
  from hits h
  where cursor_rank is null
     or (h.rank, h.id) < (cursor_rank, cursor_id)
  order by h.rank desc, h.id desc
  limit least(coalesce(page_size, 20), 50);
end;
$$;

-- ── 7. Momenti matcher: candidate's private tags leave affinity + reasons ───
-- Only the CANDIDATE side is guarded — the leak is showing a stranger's private
-- tags to the recipient; the recipient's own tags are shown only to themselves.

create or replace function public.run_momenti_matcher()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
begin
  with recipients as (
    select p.id as user_id, p.locale, p.identity_tags, p.seeking,
           (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = (now() at time zone 'utc')::date)::int as today_count
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = (now() at time zone 'utc')::date) < 3
  ),
  scored as (
    select r.user_id, r.locale, r.today_count, c.id as candidate_id,
           array(select unnest(r.identity_tags) intersect select unnest(c_tags.v)) as shared,
           array(select unnest(r.seeking)       intersect select unnest(c_tags.v)) as seek_hit,
           array(select unnest(r.identity_tags) intersect select unnest(c_seek.v)) as offer_hit
      from recipients r
      join public.profiles c on c.id <> r.user_id
      cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                      then c.identity_tags else '{}'::text[] end as v) c_tags
      cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                      then c.seeking else '{}'::text[] end as v) c_seek
     where exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > (now() at time zone 'utc')::date))
  ),
  affin as (
    select user_id, locale, today_count, candidate_id, shared, seek_hit, offer_hit,
           (coalesce(array_length(shared,1),0)
            + coalesce(array_length(seek_hit,1),0)
            + coalesce(array_length(offer_hit,1),0))::numeric as affinity
      from scored
  ),
  ranked as (
    select *, row_number() over (partition by user_id order by affinity desc, candidate_id) as rnk
      from affin
     where affinity > 0
  )
  insert into public.momento_proposals
        (user_id, candidate_id, reasons, affinity, daily_rank, proposed_on)
  select user_id, candidate_id,
         public.momento_reasons(locale, shared, seek_hit, offer_hit),
         affinity, (today_count + rnk)::smallint, (now() at time zone 'utc')::date
    from ranked
   where today_count + rnk <= 3
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ── 8. dreams / dream_milestones: visibility('dream') gate for members ──────
-- Absent key = 'members' ⇒ identical behavior until an owner opts into
-- 'private'. Owner always passes (field_visible short-circuits on auth.uid()).

drop policy "dreams_select_authenticated" on public.dreams;
create policy "dreams_select_authenticated"
  on public.dreams for select
  to authenticated
  using (deleted_at is null and athanor.field_visible(profile_id, 'dream'));

drop policy "dream_milestones_select_authenticated" on public.dream_milestones;
create policy "dream_milestones_select_authenticated"
  on public.dream_milestones for select
  to authenticated
  using (
    (deleted_at is null or public.owns_dream(dream_id))
    and exists (
      select 1 from public.dreams d
      where d.id = dream_id and athanor.field_visible(d.profile_id, 'dream')
    )
  );
