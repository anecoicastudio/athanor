-- #384 — the seven Momenti affinity terms are computed ONCE.
--
-- run_momenti_matcher() scored the terms inline at match time and get_momenti_deck()
-- recomputed them at read time from live, re-masked fields: two hand-copied chains that
-- had drifted apart in four places, three of them named on #384 and one found while
-- implementing it. Every new term cost a re-emit of both. From here there is one
-- definition — athanor.momento_terms(p_me, p_them) — which the matcher SUMS and the deck
-- PROJECTS, and a term can no longer score on one side and vanish on the other.
--
-- THE FOUR DIVERGENCES, ruled 2026-08-17 on #384. All four die; none becomes an
-- argument. The deck's reading wins each time, on one principle: a card must not score
-- on a term it cannot display.
--
--   A. CITY. The matcher fired on a 4-char geohash prefix match alone; the deck also
--      required `c.city is not null`, because «Vicino a te» has nothing to say without a
--      display name. A geohash without a city is unreachable today (20260814104755:15-16
--      — free-text city stores no geohash) but nothing in the schema forbids it. One
--      rule now, the deck's.
--
--   B. SOFT-DELETED EVENTS. The matcher counted them, the deck could not name them. With
--      the term capped at 3, weighted 1, and the threshold at 2, TWO shared evenings
--      whose listings are both gone were enough to propose a pair whose card then
--      rendered with no reasons at all. A fresh pass no longer scores a deleted listing.
--      This does NOT touch what 0100_momenti_mutual_activity.test.sql:141-164 pins: a
--      deletion landing AFTER the match still never rewrites momento_proposals.affinity.
--      The stored score stays a snapshot; only what a future pass will count changed.
--
--   C. IDS vs TITLES. The matcher intersected event ids via athanor.tag_intersect(); the
--      deck ran a five-table join for titles. Representation, not semantics — with (B)
--      settled the two cardinalities are equal, so one join now serves both: the array of
--      titles for the deck, its length for the score. Ids still never leave the server.
--
--   D. MASKING, unnamed on #384. The matcher masked the candidate inline
--      (`coalesce(visibility ->> 'x', 'members') <> 'private'`); the deck called
--      athanor.field_visible(). The matcher CANNOT call field_visible: it runs under cron
--      with no auth.uid(), which lands in that function's anon branch and would mask every
--      'members' field to empty. So the inline form is the one that survives, and it is
--      behaviour-preserving for the deck, where all three field_visible branches collapse:
--      the `auth.uid() = p_owner` branch is unreachable (the matcher enforces
--      candidate <> recipient), the anon branch is unreachable (`where auth.uid() is not
--      null`), and field_visible's own not_blocked() is already in the deck's WHERE.
--
-- SHAPE. get_momenti_deck()'s OUT list does not change, so both functions are
-- `create or replace` and neither ACL is discarded — the drop/recreate/re-grant dance of
-- 20260814134451 and 20260815061556 is not needed here. The grants are re-issued anyway,
-- so this file states the whole privilege surface it leaves behind.

-- ── 1. The tunables, as a VALUE ─────────────────────────────────────────────
--
-- Rule 10's constants have been mirrored into the SQL as bare literals since #123, and
-- affinity.mirror.test.ts pinned them with regexes over the arithmetic — so reformatting
-- the sum silently unpinned the weight the test claimed to guard (#384 item 2). A
-- function returning the tunables as jsonb is the same fact in a shape a test can compare
-- BY VALUE. It is not decorative: the scoring expression below reads its weights from
-- here, so a value that drifts from packages/core/src/onboarding/affinity.ts changes what
-- the matcher actually does, and the mirror test goes red.
--
-- IMMUTABLE and constant-folded: the planner inlines this single-SELECT body and evaluates
-- the ->> extractions once per query, not once per pair.
create function athanor.momento_affinity_constants()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    -- AFFINITY_WEIGHTS — all at parity today (#123).
    'tag',               1,   -- per element of shared / seek_hit / offer_hit
    'skill',             1,   -- per element of skills_shared (#123)
    'city',              1,   -- once, when the two geohash cells agree (#123)
    'activity',          1,   -- per shared event, up to activity_cap (#361)
    'profession',        1,   -- once, when the crafts complement (#361)
    -- MOMENTO_AFFINITY_THRESHOLD — a proposal ships at this many terms (#273 C).
    'threshold',         2,
    -- MUTUAL_ACTIVITY_CAP — mutual activity stops counting here; the ARRAY stays the
    -- full intersection so the deck can still name every shared event (#361).
    'activity_cap',      3,
    -- CITY_GEOHASH_MATCH_PRECISION — compare precision-5 cells at 4 chars, ≈20 km (#123).
    'geohash_precision', 4);
$$;

comment on function athanor.momento_affinity_constants() is
  'The Momenti affinity tunables as one jsonb value (#384): the five AFFINITY_WEIGHTS, '
  'MOMENTO_AFFINITY_THRESHOLD, MUTUAL_ACTIVITY_CAP and CITY_GEOHASH_MATCH_PRECISION. '
  'Mirrors packages/core/src/onboarding/affinity.ts, which stays where a retune is '
  'DECIDED; affinity.mirror.test.ts compares the two field by field, BY VALUE. It '
  'replaced the regexes that used to pin the matcher''s arithmetic as text — reformatting '
  'the sum unpinned the weight the assertion claimed to guard. athanor.momento_terms() '
  'reads its weights from here, so a drifted value changes scoring rather than only '
  'documentation.';

-- Same posture as the other athanor.* helpers (20260812155833): only the DEFINER
-- functions below may reach it — nobody executes it directly, service_role included.
-- NOTE 0121_grant_catalog_sweep.test.sql's function-EXECUTE assertions filter
-- nspname = 'public', so this revoke is convention and review, not something CI catches.
revoke execute on function athanor.momento_affinity_constants()
  from public, anon, authenticated, service_role;

-- ── 2. The seven terms, computed once ───────────────────────────────────────
--
-- Directed (me → them): seek_hit and offer_hit swap when the pair is scored the other way
-- round. p_me's own fields are NEVER masked — you always see yourself; p_them's are masked
-- per divergence D above.
--
-- Returns the display arrays AND the score. The matcher takes .affinity and throws the
-- arrays away; the deck projects the arrays and never sees the number (rule 1). Neither
-- one recomputes anything.
--
-- Returns ZERO rows when either profile id is absent, which drops the pair at both call
-- sites — the same thing the deck's old `join me on me.id = mp.user_id` did.
create function athanor.momento_terms(p_me uuid, p_them uuid)
returns table (
  shared          text[],
  seek_hit        text[],
  offer_hit       text[],
  skills_shared   text[],
  city_near       text[],
  mutual_activity text[],
  profession_pair text[],
  affinity        numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with k as (select athanor.momento_affinity_constants() as c),
  me as (
    select p.identity_tags, p.seeking, p.skills, p.city_geohash, p.profession
      from public.profiles p
     where p.id = p_me
  ),
  them as (
    -- Divergence D: the matcher's inline form, which is the one that works with and
    -- without an auth.uid(). 'city' gates the geohash AND the display name together —
    -- one knob, one field.
    select case when coalesce(p.visibility ->> 'identity_tags', 'members') <> 'private'
                then p.identity_tags else '{}'::text[] end as identity_tags,
           case when coalesce(p.visibility ->> 'seeking', 'members') <> 'private'
                then p.seeking else '{}'::text[] end as seeking,
           case when coalesce(p.visibility ->> 'skills', 'members') <> 'private'
                then p.skills else '{}'::text[] end as skills,
           case when coalesce(p.visibility ->> 'city', 'members') <> 'private'
                then p.city_geohash else null end as city_geohash,
           case when coalesce(p.visibility ->> 'city', 'members') <> 'private'
                then p.city else null end as city,
           case when coalesce(p.visibility ->> 'profession', 'members') <> 'private'
                then p.profession else null end as profession
      from public.profiles p
     where p.id = p_them
  ),
  t as (
    select
      -- you both are …
      athanor.tag_intersect(me.identity_tags, them.identity_tags) as shared,
      -- … they are what you seek …
      athanor.tag_intersect(athanor.seeking_to_identity(me.seeking), them.identity_tags) as seek_hit,
      -- … and you are what they seek (#273 A) …
      athanor.tag_intersect(me.identity_tags, athanor.seeking_to_identity(them.seeking)) as offer_hit,
      -- … you both know how to … (#123)
      athanor.tag_intersect(me.skills, them.skills) as skills_shared,
      -- «Vicino a te» (#123): the candidate's city DISPLAY NAME, and only that — never the
      -- geohash, never a coordinate (0098's non-projection promise holds). Divergence A:
      -- the name is required, not optional, so the term never scores un-displayable.
      case when me.city_geohash is not null and them.city_geohash is not null
                and them.city is not null
                and left(me.city_geohash,   (k.c ->> 'geohash_precision')::int)
                  = left(them.city_geohash, (k.c ->> 'geohash_precision')::int)
           then array[them.city] else '{}'::text[] end as city_near,
      -- «Avete già condiviso» (#361): TITLES of events both sides were CHECKED IN at,
      -- newest first — verified presence, never RSVP intent, and only rooms the caller was
      -- in themselves. Divergences B and C: one join, soft-deleted listings excluded, and
      -- the score is this array's length rather than a separate id intersection.
      -- unique(ticket_id) on attendance and unique(user_id, event_id) on tickets make one
      -- row per shared event.
      coalesce((
        select array_agg(e.title order by e.starts_at desc, e.id)
          from public.event_attendance mea
          join public.event_tickets   mt on mt.id = mea.ticket_id and mt.user_id = p_me
          join public.event_attendance cea on cea.event_id = mea.event_id
          join public.event_tickets   ct on ct.id = cea.ticket_id and ct.user_id = p_them
          join public.events e on e.id = mea.event_id and e.deleted_at is null
      ), '{}'::text[]) as mutual_activity,
      -- «Mestieri che si completano» (#361): the two profession KEYS, caller's craft first
      -- — the client localizes them from tag.profession.*. Either side unset, masked, or
      -- carrying an uncurated legacy key (the column is app-validated, not CHECK-pinned)
      -- scores zero, gracefully.
      case when me.profession is not null and them.profession is not null
                and them.profession = any(athanor.profession_complements(me.profession))
           then array[me.profession, them.profession] else '{}'::text[] end as profession_pair
      from me cross join them cross join k
  )
  select t.shared, t.seek_hit, t.offer_hit, t.skills_shared,
         t.city_near, t.mutual_activity, t.profession_pair,
         -- The weighted sum, term by term rather than as one length total: city_near and
         -- profession_pair are ONCE-per-pair terms that happen to carry 1 and 2 elements,
         -- so counting their lengths would weight the craft pairing double.
         ( (k.c ->> 'tag')::numeric * (coalesce(array_length(t.shared, 1), 0)
                                     + coalesce(array_length(t.seek_hit, 1), 0)
                                     + coalesce(array_length(t.offer_hit, 1), 0))
         + (k.c ->> 'skill')::numeric * coalesce(array_length(t.skills_shared, 1), 0)
         + case when cardinality(t.city_near) > 0 then (k.c ->> 'city')::numeric else 0 end
         + (k.c ->> 'activity')::numeric * least((k.c ->> 'activity_cap')::int,
                                                 coalesce(array_length(t.mutual_activity, 1), 0))
         + case when cardinality(t.profession_pair) > 0 then (k.c ->> 'profession')::numeric else 0 end
         )::numeric
    from t cross join k;
$$;

comment on function athanor.momento_terms(uuid, uuid) is
  'The seven Momenti affinity terms for one DIRECTED pair, computed once (#384) — '
  'run_momenti_matcher() sums the affinity column, get_momenti_deck() projects the seven '
  'arrays, and neither recomputes anything. p_me is never masked (you always see '
  'yourself); p_them is masked field by field against profiles.visibility, inline rather '
  'than through athanor.field_visible(), because the matcher runs under cron with no '
  'auth.uid() and would land in that function''s anon branch. Callers keep their own block '
  'gate: this function has none. Terms: shared identity, their identity answering your '
  'seeking, yours answering theirs (#273 A), shared skills and city proximity (#123), '
  'mutual activity as event TITLES (#361, ids never leave the server, soft-deleted '
  'listings excluded) and complementary professions (#361). Weights, threshold, cap and '
  'geohash precision all come from athanor.momento_affinity_constants(). Returns no rows '
  'when either profile is absent, which drops the pair at both call sites.';

revoke execute on function athanor.momento_terms(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ── 3. The matcher: sums the terms ──────────────────────────────────────────
--
-- Return type unchanged, so `create or replace` and the ACL survives. Caps, expiry,
-- threshold, fallback and the block/visibility predicates are 20260815061556's; what
-- changed is that the scoring CTE chain collapsed into one lateral.
--
-- `pairs` is MATERIALIZED deliberately: it carries every gate that can reject a pair
-- without scoring it (active dream both ways, dream not private, not blocked, no live
-- proposal or pass), so the planner cannot hoist the per-pair term computation above them.
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
    select p.id as user_id, c.today_count, c.pending_count
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
  pairs as materialized (
    select r.user_id, r.today_count, r.pending_count, c.id as candidate_id
      from recipients r
      join public.profiles c on c.id <> r.user_id
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
    select p.user_id, p.today_count, p.pending_count, p.candidate_id, t.affinity
      from pairs p
      cross join lateral athanor.momento_terms(p.user_id, p.candidate_id) t
  ),
  ranked as (
    select *, row_number() over (partition by user_id order by affinity desc, candidate_id) as rnk
      from affin
     where affinity >= (athanor.momento_affinity_constants() ->> 'threshold')::numeric
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
  'Nightly Momenti matcher (03:11 UTC cron). Scores each recipient×candidate pair on the '
  'seven terms of athanor.momento_terms() — which get_momenti_deck() then PROJECTS, so a '
  'term can no longer score on one side and vanish on the other (#384). Proposes above '
  'the threshold in athanor.momento_affinity_constants() (#273 C). The cap is at most 3 '
  'WAITING proposals and at most 3 written per day (#273 B). A recipient the pass leaves '
  'with an empty deck gets one dream-recency card at affinity 0 instead (#273 E). Writes '
  'NO reason prose: the deck recomputes the terms at read time from current, re-masked '
  'fields (#273 D). The stored affinity is a SNAPSHOT and never chases later edits or '
  'deletions.';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- ── 4. The deck: projects the terms ─────────────────────────────────────────
--
-- The OUT list is IDENTICAL to 20260815061556's, so this is `create or replace` and the
-- ACL survives — no 42P13, no drop, no re-grant needed. The grants below are re-issued
-- anyway so this file states the whole privilege surface it leaves behind.
create or replace function public.get_momenti_deck()
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
  city_near    text[],
  mutual_activity text[],
  profession_pair text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    mp.id,
    c.id,
    c.handle,
    c.display_name,
    c.avatar_path,
    d.text,
    -- The KIND, never the score: affinity stays server-only (rule 1). 0 is only ever
    -- written by the dream-recency fallback.
    case when mp.affinity = 0 then 'new_dream' else 'affinity' end,
    -- Recomputed and re-masked on every read (#273 D) — by the same function the matcher
    -- scored with (#384). t.affinity is deliberately not projected.
    t.shared,
    t.seek_hit,
    t.offer_hit,
    t.skills_shared,
    t.city_near,
    t.mutual_activity,
    t.profession_pair
  from public.momento_proposals mp
  join public.profiles c on c.id = mp.candidate_id
  cross join lateral athanor.momento_terms(mp.user_id, c.id) t
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
    and mp.user_id = (select auth.uid())
    and mp.status = 'pending'
    and athanor.not_blocked(c.id)
    and athanor.field_visible(c.id, 'dream')
  -- #273 B: newest DAY first, then the rank within that day.
  order by mp.proposed_on desc, mp.daily_rank asc
  limit 3;
$$;

comment on function public.get_momenti_deck() is
  'Today-first deck of at most 3 pending Momenti for the caller. The affinity terms come '
  'from athanor.momento_terms() — the SAME function run_momenti_matcher() scored the pair '
  'with (#384) — recomputed and re-masked at read time from the candidate''s current '
  'fields (#273 D); the client localizes them from tag.identity.* / tag.skill.* / '
  'tag.profession.* + momenti.reason.*. city_near carries the candidate''s city display '
  'name at most, NEVER the geohash (0098). mutual_activity carries titles of events BOTH '
  'sides were checked in at, shown only to a caller who was in the same room; event ids '
  'never leave the server. profession_pair carries the two profession KEYS, caller''s '
  'first. reason_kind is ''new_dream'' for a dream-recency fallback card and ''affinity'' '
  'otherwise; the affinity NUMBER is never returned (rule 1). DEFINER because '
  'profiles.visibility and the gated columns are not readable by authenticated; the '
  'caller comes from auth.uid(), blocked pairs drop both ways.';

revoke execute on function public.get_momenti_deck() from public, anon;
grant execute on function public.get_momenti_deck() to authenticated;
