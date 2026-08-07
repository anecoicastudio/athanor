-- M10 visibility follow-ups (review findings on 20260807170813).
-- Four gaps in the enforcement pass, none of which the earlier migration can be
-- edited to fix (append-only, rule 7):
--   1. athanor.profile_search_text / visible_bio skipped the auth.uid() +
--      not_blocked re-check every other DEFINER accessor performs. Unreachable
--      through PostgREST today (the athanor schema is not exposed) but a future
--      direct caller would read a blocked peer's fields.
--   2. run_momenti_matcher still proposed candidates whose DREAM is private, so
--      the deck rendered a Momento whose dream text was RLS-filtered to null.
--      Uses the raw jsonb check, NOT athanor.field_visible: the matcher runs as
--      a service-role cron job with no auth.uid(), where field_visible falls to
--      its anon branch and would exclude every members-default profile.
--   3. dream_milestones: the visibility gate made the owner-escape-hatch from
--      20260616083015 unreachable for a SOFT-DELETED parent dream (the exists
--      sub-select is itself filtered by the new dreams policy), so owners lost
--      sight of their own tappe. Ownership is now established with a DEFINER
--      helper that does not depend on the dream row being selectable.
--   4. public.profiles is in the supabase_realtime publication. Realtime applies
--      row RLS but not column privileges, so the M10 column revoke was
--      bypassable by subscribing to profiles UPDATEs. The publication now
--      carries an explicit column list (PG15+) matching the authenticated grant.
--
-- Product note (matcher): a member who marks identity_tags 'private' scores
-- affinity 0 against everyone and therefore drops out of Momenti matching
-- entirely. That is the intended privacy trade (no tags shared ⇒ no tag-based
-- match); asserted in supabase/tests/0073_visibility_followups.test.sql.

-- ── 1. DEFINER helpers re-check the caller ──────────────────────────────────

create or replace function athanor.profile_search_text(p_id uuid)
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
  where p.id = p_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

create or replace function athanor.visible_bio(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when athanor.field_visible(p.id, 'bio') then p.bio end
  from public.profiles p
  where p.id = p_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

-- ── 2. Matcher: skip candidates whose dream is private ──────────────────────

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
       -- a private dream would be RLS-filtered out of the deck card, leaving a
       -- Momento with no dream text — don't propose the candidate at all.
       and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
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

-- ── 3. Owners keep their own tappe, even under a soft-deleted dream ─────────

-- public.owns_dream is SECURITY INVOKER, so it stops seeing a soft-deleted or
-- visibility-gated parent dream once the M10 policy lands. This DEFINER twin
-- answers "is this dream mine?" independently of the dreams row policy.
create function athanor.owns_dream(p_dream_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dreams d
    where d.id = p_dream_id and d.profile_id = (select auth.uid())
  );
$$;

revoke execute on function athanor.owns_dream(uuid) from public, anon;
grant execute on function athanor.owns_dream(uuid) to authenticated;

drop policy "dream_milestones_select_authenticated" on public.dream_milestones;
create policy "dream_milestones_select_authenticated"
  on public.dream_milestones for select
  to authenticated
  using (
    athanor.owns_dream(dream_id)
    -- non-owners: live tappe of a dream the caller can actually read (the dreams
    -- policy already applies deleted_at + field_visible('dream')).
    or (deleted_at is null and exists (select 1 from public.dreams d where d.id = dream_id))
  );

-- ── 4. Realtime publication: column list matching the authenticated grant ───
-- Realtime enforces row RLS but not column privileges; without this, a member
-- could subscribe to profiles UPDATEs and receive bio/identity_tags/seeking in
-- the payload. The list mirrors the M10 grant (id is the replica identity).

alter publication supabase_realtime drop table public.profiles;
alter publication supabase_realtime add table public.profiles
  (id, handle, founding_member, identity_verified, created_at, updated_at);
