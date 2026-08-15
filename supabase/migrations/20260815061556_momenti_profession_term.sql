-- #361 — Momenti affinity gains its seventh term: PROFESSION COMPLEMENTARITY — the
-- crafts that ship things together (design with the people who build it, business with
-- the people who keep it legal, music with the people who film it).
--
-- THE MAP (ruled 2026-08-15, recorded on #361): symmetric sparse pairs, 2–4 complements
-- per profession, DELIBERATELY — a map where everything complements everything scores
-- every pair, and the term becomes the noise the #273 C threshold removed. Same-craft
-- pairs are absent on purpose: «you both are» is the shared-identity terms' signal.
-- packages/core/src/onboarding/affinity.ts (PROFESSION_COMPLEMENTS) stays the source of
-- truth; athanor.profession_complements() below is its SQL copy and
-- affinity.mirror.test.ts asserts the two agree, pair for pair.
--
-- SHAPE. profiles.profession is a SCALAR (single-select, #149), so the map function
-- takes one text key and returns its complements — smaller than the array-unnest shape
-- of athanor.seeking_to_identity(), same contract. The term fires ONCE per pair (like
-- city proximity), at AFFINITY_WEIGHTS.profession = 1 (parity). A member with no
-- profession — or one from outside the curated vocabulary, possible because the column
-- is app-validated rather than CHECK-pinned — contributes zero, gracefully.
--
-- MASKING. profession has a visibility knob (#149): the matcher blanks a private
-- candidate value to NULL, the deck re-checks athanor.field_visible() per read. The
-- recipient's own side is never masked from themselves.
--
-- run_momenti_matcher() is `create or replace` (return type unchanged);
-- get_momenti_deck() adds an OUT column, which Postgres refuses in place (42P13), so
-- it is drop + recreate + re-issued grants — the #299/#149/#123/#361 precedent.

-- ── 1. The map ──────────────────────────────────────────────────────────────
--
-- MIRRORS packages/core/src/onboarding/affinity.ts — edit both or the mirror test
-- fails. 46 directed rows = 23 symmetric pairs; every key appears on both sides.
create function athanor.profession_complements(p_profession text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(select m.complement
            from (values
              ('design', 'artigianato'),
              ('design', 'comunicazione'),
              ('design', 'marketing'),
              ('design', 'sviluppo'),
              ('sviluppo', 'business'),
              ('sviluppo', 'design'),
              ('sviluppo', 'ricerca'),
              ('arte', 'artigianato'),
              ('arte', 'comunicazione'),
              ('arte', 'musica'),
              ('musica', 'arte'),
              ('musica', 'foto-video'),
              ('scrittura', 'comunicazione'),
              ('scrittura', 'educazione'),
              ('scrittura', 'marketing'),
              ('foto-video', 'food'),
              ('foto-video', 'marketing'),
              ('foto-video', 'musica'),
              ('marketing', 'business'),
              ('marketing', 'design'),
              ('marketing', 'foto-video'),
              ('marketing', 'scrittura'),
              ('comunicazione', 'arte'),
              ('comunicazione', 'design'),
              ('comunicazione', 'scrittura'),
              ('business', 'finanza'),
              ('business', 'legale'),
              ('business', 'marketing'),
              ('business', 'sviluppo'),
              ('finanza', 'business'),
              ('finanza', 'legale'),
              ('legale', 'business'),
              ('legale', 'finanza'),
              ('educazione', 'benessere'),
              ('educazione', 'ricerca'),
              ('educazione', 'scrittura'),
              ('artigianato', 'arte'),
              ('artigianato', 'design'),
              ('artigianato', 'food'),
              ('ricerca', 'educazione'),
              ('ricerca', 'sviluppo'),
              ('benessere', 'educazione'),
              ('benessere', 'food'),
              ('food', 'artigianato'),
              ('food', 'benessere'),
              ('food', 'foto-video')
            ) as m(profession, complement)
           where m.profession = p_profession
           order by 1),
    '{}'::text[]);
$$;

comment on function athanor.profession_complements(text) is
  'The professions that COMPLEMENT one (#361) — the crafts that ship things together, '
  'as ruled on the issue: symmetric sparse pairs, 2-4 complements each, no self-pairs. '
  'Scalar in, array out: profiles.profession is single-select (#149). Mirrors '
  'PROFESSION_COMPLEMENTS in packages/core/src/onboarding/affinity.ts — '
  'affinity.mirror.test.ts asserts the two copies agree. NULL or an uncurated key '
  'returns {}, so a legacy free-text row scores nothing rather than erroring.';

-- Same posture as the other athanor.* helpers (20260812155833): only the DEFINER
-- functions below may reach it — nobody executes it directly, service_role included.
revoke execute on function athanor.profession_complements(text)
  from public, anon, authenticated, service_role;

-- ── 2. The matcher: seven terms ─────────────────────────────────────────────
--
-- Body is 20260814134451's plus the profession columns and the once-per-pair term;
-- everything else — caps, expiry, threshold, fallback, block/visibility predicates —
-- unchanged.
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
  with attended as (
    -- One row per member who ever checked in anywhere: their event ids, as text so
    -- athanor.tag_intersect() applies unchanged. unique(ticket_id) on attendance and
    -- unique(user_id, event_id) on tickets make the pair already distinct.
    select t.user_id, array_agg(ea.event_id::text order by ea.event_id::text) as event_ids
      from public.event_attendance ea
      join public.event_tickets t on t.id = ea.ticket_id
     group by t.user_id
  ),
  recipients as (
    select p.id as user_id, p.identity_tags, p.seeking, p.skills, p.city_geohash,
           p.profession,
           att.event_ids as attended_events,
           c.today_count, c.pending_count
      from public.profiles p
      left join attended att on att.user_id = p.id
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
            and left(r.city_geohash, 4) = left(c_city.v, 4)) as city_near,
           -- … and you were both THERE (#361). tag_intersect is NULL-safe, so a member
           -- who never checked in anywhere intersects as empty, never as an error.
           athanor.tag_intersect(r.attended_events, c_att.event_ids) as mutual_activity,
           -- … and your crafts complete each other (#361). Either side without a
           -- profession — unset, masked, or an uncurated legacy key that the map
           -- resolves to {} — makes this false, never an error.
           (r.profession is not null and c_prof.v is not null
            and c_prof.v = any(athanor.profession_complements(r.profession))) as profession_match
      from recipients r
      join public.profiles c on c.id <> r.user_id
      left join attended c_att on c_att.user_id = c.id
      cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                      then c.identity_tags else '{}'::text[] end as v) c_tags
      cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                      then c.seeking else '{}'::text[] end as v) c_seek
      cross join lateral (select case when coalesce(c.visibility ->> 'skills', 'members') <> 'private'
                                      then c.skills else '{}'::text[] end as v) c_skills
      cross join lateral (select case when coalesce(c.visibility ->> 'city', 'members') <> 'private'
                                      then c.city_geohash else null end as v) c_city
      cross join lateral (select case when coalesce(c.visibility ->> 'profession', 'members') <> 'private'
                                      then c.profession else null end as v) c_prof
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
           -- Mutual activity is the one CAPPED term (MUTUAL_ACTIVITY_CAP): the sum stops
           -- at 3 shared events even when the array carries more. Profession
           -- complementarity fires ONCE per pair, like city proximity.
           (1 * (coalesce(array_length(shared,1),0)
               + coalesce(array_length(seek_hit,1),0)
               + coalesce(array_length(offer_hit,1),0))
            + 1 * coalesce(array_length(skills_shared,1),0)
            + case when city_near then 1 else 0 end
            + 1 * least(3, coalesce(array_length(mutual_activity,1),0))
            + case when profession_match then 1 else 0 end)::numeric as affinity
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
  'Nightly Momenti matcher (03:11 UTC cron). Scores each recipient×candidate pair on seven '
  'terms — shared identity, their identity answering your seeking, your identity answering '
  'theirs (#273 A), shared skills, city proximity at a 4-char geohash prefix (#123), '
  'mutual activity: verified co-attendance, capped at MUTUAL_ACTIVITY_CAP shared events, '
  'and profession complementarity per athanor.profession_complements(), once per pair '
  '(#361) — above an affinity threshold of 2 (#273 C). Weights are AFFINITY_WEIGHTS in '
  'packages/core/src/onboarding/affinity.ts, mirrored here as literals (all parity today). '
  'The cap is at most 3 WAITING proposals and at most 3 written per day (#273 B). A '
  'recipient the pass leaves with an empty deck gets one dream-recency card at affinity 0 '
  'instead (#273 E). Writes NO reason prose: get_momenti_deck() computes the terms at read '
  'time (#273 D).';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- ── 3. The deck read path: one more term array ──────────────────────────────
--
-- drop + create, not `create or replace`: Postgres refuses to change an OUT-parameter
-- list in place (42P13), and dropping discards the ACL, so the revoke/grant pair is
-- re-issued below (the 20260814134451 precedent).
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
  city_near    text[],
  mutual_activity text[],
  profession_pair text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.identity_tags, p.seeking, p.skills, p.city_geohash, p.profession
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
         then array[c.city] else '{}'::text[] end,
    -- «Avete già condiviso» (#361): TITLES of events both sides were checked in at,
    -- newest event first. Only rooms the CALLER was in — a co-attendee learns nothing
    -- they could not have seen from inside it. Ids never leave the server; a
    -- soft-deleted event still scores in the matcher but is not named here.
    coalesce((
      select array_agg(e.title order by e.starts_at desc, e.id)
        from public.event_attendance mea
        join public.event_tickets   mt on mt.id = mea.ticket_id and mt.user_id = me.id
        join public.event_attendance cea on cea.event_id = mea.event_id
        join public.event_tickets   ct on ct.id = cea.ticket_id and ct.user_id = c.id
        join public.events e on e.id = mea.event_id and e.deleted_at is null
    ), '{}'::text[]),
    -- «Mestieri che si completano» (#361): the pair of profession KEYS, caller's craft
    -- first — the client localizes them from tag.profession.*. Empty when either side
    -- has no profession, when the pair is not in the map, or when the candidate's
    -- 'profession' is masked (c_prof.v is null then).
    case when me.profession is not null and c_prof.v is not null
              and c_prof.v = any(athanor.profession_complements(me.profession))
         then array[me.profession, c_prof.v] else '{}'::text[] end
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
  cross join lateral (select case when athanor.field_visible(c.id, 'profession')
                                  then c.profession else null end as v) c_prof
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
  'fields (#273 D) — the client localizes them from tag.identity.* / tag.skill.* / '
  'tag.profession.* + momenti.reason.*. skills_shared and city_near are #123''s terms; '
  'city_near carries the candidate''s city display name at most, NEVER the geohash '
  '(0098). mutual_activity (#361) carries titles of events BOTH sides were checked in '
  'at — verified co-attendance, shown only to a caller who was in the same room; event '
  'ids never leave the server. profession_pair (#361) carries the two profession KEYS, '
  'caller''s first, when the crafts complement each other per '
  'athanor.profession_complements() and the candidate keeps the field visible. '
  'reason_kind is ''new_dream'' for a dream-recency fallback card and ''affinity'' '
  'otherwise; the affinity NUMBER is never returned (rule #1). DEFINER because '
  'profiles.visibility and the gated columns are not readable by authenticated; the '
  'caller comes from auth.uid(), blocked pairs drop both ways.';

revoke execute on function public.get_momenti_deck() from public, anon;
grant execute on function public.get_momenti_deck() to authenticated;
