-- #123 — Momenti affinity gains its fourth and fifth terms: skills overlap and city
-- proximity, on the columns #149 landed (20260814104755).
--
--   · Skills overlap — |my skills ∩ their skills| over the curated keys, the exact
--     shape of the tag terms (athanor.tag_intersect). Each shared skill weighs like a
--     shared tag (AFFINITY_WEIGHTS.skill = 1, parity — see below).
--
--   · City proximity — the two precision-5 geohashes agree on their first 4
--     characters (≈ 20 km cell). #149 stored precision 5 precisely so the matcher
--     could compare at 4: the threshold is tunable by editing one literal here plus
--     the constant in core, never by re-migrating the column. A member with no
--     geohash (free-text city, or a masked field) contributes zero, gracefully —
--     the term never fires and never excludes. Weighs once, like one shared tag
--     (AFFINITY_WEIGHTS.city = 1).
--
-- WEIGHTS. packages/core/src/onboarding/affinity.ts is the source of truth
-- (AFFINITY_WEIGHTS, CITY_GEOHASH_MATCH_PRECISION, MOMENTO_AFFINITY_THRESHOLD);
-- this file hardcodes their literals and affinity.mirror.test.ts pins each one, so a
-- retune that lands in one language alone goes red in core's suite. All weights start
-- at parity — retuning on real data is a product decision deliberately left open.
--
-- MASKING follows the #273 asymmetry (asserted by 0073): the candidate side is
-- masked — private 'skills' blanks the array, private 'city' nulls the geohash — and
-- the recipient side is read raw, matching identity_tags/seeking. The matcher keeps
-- the RAW jsonb visibility check (cron has no auth.uid(), so field_visible would fall
-- to its anon branch); get_momenti_deck(), which has a caller, uses field_visible.
--
-- THE REASON NEVER EXPOSES THE GEOHASH. The deck's new city term carries the
-- candidate's city DISPLAY NAME at most ('{Milano}'), only when 'city' is visible to
-- the caller; the geohash stays server-side (0098 asserts it is never projected
-- third-person, and this projection does not start).
--
-- run_momenti_matcher() is `create or replace` (return type unchanged);
-- get_momenti_deck() adds OUT columns, which Postgres refuses in place (42P13), so it
-- is drop + recreate + re-issued grants — the #299/#149 precedent.

-- ── 1. The matcher: five terms ──────────────────────────────────────────────
--
-- Body is 20260812151459's (backlog gate) plus the two new terms; everything else —
-- caps, expiry, threshold, fallback, block/visibility predicates — is unchanged.
create or replace function public.run_momenti_matcher()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_fallback int := 0;
  v_today date := (now() at time zone 'utc')::date;
begin
  perform public.expire_momento_proposals();

  -- ── affinity pass ──
  with recipients as (
    select p.id as user_id, p.identity_tags, p.seeking, p.skills, p.city_geohash,
           c.today_count, c.pending_count
      from public.profiles p
      cross join lateral (
        select count(*) filter (where mp.proposed_on = v_today)::int as today_count,
               count(*) filter (where mp.status = 'pending')::int    as pending_count
          from public.momento_proposals mp
         where mp.user_id = p.id
      ) c
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and c.today_count < 3
       -- the deck is at most three WAITING cards, not three new ones a night (#273 B)
       and c.pending_count < 3
  ),
  scored as (
    select r.user_id, r.today_count, r.pending_count, c.id as candidate_id,
           -- you both are …
           athanor.tag_intersect(r.identity_tags, c_tags.v) as shared,
           -- … they are what you seek …
           athanor.tag_intersect(athanor.seeking_to_identity(r.seeking), c_tags.v) as seek_hit,
           -- … and you are what they seek …
           athanor.tag_intersect(r.identity_tags, athanor.seeking_to_identity(c_seek.v)) as offer_hit,
           -- … you both know how to … (#123)
           athanor.tag_intersect(r.skills, c_skills.v) as skills_shared,
           -- … and you are near each other (#123). Either side without a geohash —
           -- free-text city, masked field — makes this false, never an error.
           (r.city_geohash is not null and c_city.v is not null
            and left(r.city_geohash, 4) = left(c_city.v, 4)) as city_near
      from recipients r
      join public.profiles c on c.id <> r.user_id
      cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                      then c.identity_tags else '{}'::text[] end as v) c_tags
      cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                      then c.seeking else '{}'::text[] end as v) c_seek
      cross join lateral (select case when coalesce(c.visibility ->> 'skills', 'members') <> 'private'
                                      then c.skills else '{}'::text[] end as v) c_skills
      cross join lateral (select case when coalesce(c.visibility ->> 'city', 'members') <> 'private'
                                      then c.city_geohash else null end as v) c_city
     where exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
       and athanor.pair_not_blocked(r.user_id, c.id)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > v_today))
  ),
  affin as (
    select user_id, today_count, pending_count, candidate_id,
           -- AFFINITY_WEIGHTS, mirrored (parity today — the mirror test pins each literal).
           (1 * (coalesce(array_length(shared,1),0)
               + coalesce(array_length(seek_hit,1),0)
               + coalesce(array_length(offer_hit,1),0))
            + 1 * coalesce(array_length(skills_shared,1),0)
            + case when city_near then 1 else 0 end)::numeric as affinity
      from scored
  ),
  ranked as (
    select *, row_number() over (partition by user_id order by affinity desc, candidate_id) as rnk
      from affin
     where affinity >= 2
  )
  insert into public.momento_proposals
        (user_id, candidate_id, affinity, daily_rank, proposed_on)
  select user_id, candidate_id,
         affinity, (today_count + rnk)::smallint, v_today
    from ranked
   -- daily_rank is unique per (user, day) and capped at 3, so it still counts today's rows;
   -- pending_count is the ceiling on what the member is actually holding.
   where today_count + rnk <= 3
     and pending_count + rnk <= 3
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- ── dream-recency fallback (#273 E) ── unchanged
  with starving as (
    select p.id as user_id,
           (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today)::int as today_count
      from public.profiles p
     where exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and not exists (select 1 from public.momento_proposals mp
                        where mp.user_id = p.id and mp.status = 'pending')
       and (select count(*) from public.momento_proposals mp
             where mp.user_id = p.id
               and mp.proposed_on = v_today) < 3
  ),
  pick as (
    select s.user_id, s.today_count, c.id as candidate_id,
           row_number() over (partition by s.user_id
                              order by d.created_at desc, c.id) as rnk
      from starving s
      join public.profiles c on c.id <> s.user_id
      join lateral (
        select dd.created_at
          from public.dreams dd
         where dd.profile_id = c.id and dd.status = 'active' and dd.deleted_at is null
         order by dd.created_at desc
         limit 1
      ) d on true
     where coalesce(c.visibility ->> 'dream', 'members') <> 'private'
       and not (coalesce(c.visibility ->> 'identity_tags', 'members') = 'private'
            and coalesce(c.visibility ->> 'seeking', 'members') = 'private')
       and athanor.pair_not_blocked(s.user_id, c.id)
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = s.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > v_today))
  )
  insert into public.momento_proposals
        (user_id, candidate_id, affinity, daily_rank, proposed_on)
  select user_id, candidate_id, 0, (today_count + 1)::smallint, v_today
    from pick
   where rnk = 1
  on conflict (user_id, candidate_id) do nothing;

  get diagnostics v_fallback = row_count;
  return v_inserted + v_fallback;
end;
$$;

comment on function public.run_momenti_matcher() is
  'Nightly Momenti matcher (03:11 UTC cron). Scores each recipient×candidate pair on five '
  'terms — shared identity, their identity answering your seeking, your identity answering '
  'theirs (#273 A), shared skills, and city proximity at a 4-char geohash prefix (#123) — '
  'above an affinity threshold of 2 (#273 C). Weights are AFFINITY_WEIGHTS in packages/core/'
  'src/onboarding/affinity.ts, mirrored here as literals (all parity today). The cap is at '
  'most 3 WAITING proposals and at most 3 written per day (#273 B). A recipient the pass '
  'leaves with an empty deck gets one dream-recency card at affinity 0 instead (#273 E). '
  'Writes NO reason prose: get_momenti_deck() computes the terms at read time (#273 D).';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- ── 2. The deck read path: two more term arrays ─────────────────────────────
--
-- drop + create, not `create or replace`: Postgres refuses to change an OUT-parameter
-- list in place (42P13), and dropping discards the ACL, so the revoke/grant pair is
-- re-issued below (the 20260814104755 precedent).
drop function public.get_momenti_deck();

create function public.get_momenti_deck()
returns table (
  proposal_id  uuid,
  candidate_id uuid,
  handle       text,
  display_name text,
  avatar_path  text,
  dream_text   text,
  reason_kind  text,
  shared       text[],
  seek_hit     text[],
  offer_hit    text[],
  skills_shared text[],
  city_near    text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.identity_tags, p.seeking, p.skills, p.city_geohash
      from public.profiles p
     where p.id = (select auth.uid())
  )
  select
    mp.id,
    c.id,
    c.handle,
    c.display_name,
    c.avatar_path,
    d.text,
    -- The KIND, never the score: affinity stays server-only (rule #1). 0 is only ever
    -- written by the dream-recency fallback.
    case when mp.affinity = 0 then 'new_dream' else 'affinity' end,
    athanor.tag_intersect(me.identity_tags, c_tags.v),
    athanor.tag_intersect(athanor.seeking_to_identity(me.seeking), c_tags.v),
    athanor.tag_intersect(me.identity_tags, athanor.seeking_to_identity(c_seek.v)),
    -- … you both know how to … (#123)
    athanor.tag_intersect(me.skills, c_skills.v),
    -- «Vicino a te» (#123): the candidate's city DISPLAY NAME, and only that — never
    -- the geohash, never a coordinate (0098's non-projection promise holds). Empty
    -- when either side lacks a geohash, when the cells disagree at the 4-char match
    -- precision, or when the candidate's 'city' is masked (c_city.v is null then).
    case when me.city_geohash is not null and c_city.v is not null
              and left(me.city_geohash, 4) = left(c_city.v, 4)
              and c.city is not null
         then array[c.city] else '{}'::text[] end
  from public.momento_proposals mp
  join me on me.id = mp.user_id
  join public.profiles c on c.id = mp.candidate_id
  -- Recomputed and re-masked on every read (#273 D).
  cross join lateral (select case when athanor.field_visible(c.id, 'identity_tags')
                                  then c.identity_tags else '{}'::text[] end as v) c_tags
  cross join lateral (select case when athanor.field_visible(c.id, 'seeking')
                                  then c.seeking else '{}'::text[] end as v) c_seek
  cross join lateral (select case when athanor.field_visible(c.id, 'skills')
                                  then c.skills else '{}'::text[] end as v) c_skills
  cross join lateral (select case when athanor.field_visible(c.id, 'city')
                                  then c.city_geohash else null end as v) c_city
  -- A Momento with no dream has nothing to answer, so an archived or hidden dream
  -- drops the card rather than rendering it empty.
  join lateral (
    select dd.text
      from public.dreams dd
     where dd.profile_id = c.id and dd.status = 'active' and dd.deleted_at is null
     order by dd.created_at desc
     limit 1
  ) d on true
  where (select auth.uid()) is not null
    and mp.status = 'pending'
    and athanor.not_blocked(c.id)
    and athanor.field_visible(c.id, 'dream')
  -- #273 B: newest DAY first, then the rank within that day.
  order by mp.proposed_on desc, mp.daily_rank asc
  limit 3;
$$;

comment on function public.get_momenti_deck() is
  'Today-first deck of at most 3 pending Momenti for the caller, with the affinity '
  'terms RECOMPUTED at read time from the candidate''s current, visibility-masked '
  'fields (#273 D) — the client localizes them from tag.identity.* / tag.skill.* + '
  'momenti.reason.*. skills_shared and city_near are #123''s terms; city_near carries '
  'the candidate''s city display name at most, NEVER the geohash (0098). reason_kind '
  'is ''new_dream'' for a dream-recency fallback card and ''affinity'' otherwise; the '
  'affinity NUMBER is never returned (rule #1). DEFINER because profiles.visibility '
  'and the gated columns are not readable by authenticated; the caller comes from '
  'auth.uid(), blocked pairs drop both ways.';

revoke execute on function public.get_momenti_deck() from public, anon;
grant execute on function public.get_momenti_deck() to authenticated;
