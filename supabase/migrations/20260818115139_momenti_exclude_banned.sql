-- #314, beyond the issue — Momenti must not propose, or propose to, a banned member.
--
-- Found while implementing #314's read side. The ruling's table names feed, search, the public
-- web and the member-facing profile; it does not name Momenti, because nobody had looked. But a
-- banned member surfacing in someone's deck as a card to answer is presence in exactly the sense
-- the ruling removes — arguably the loudest form of it, since a Momento is an invitation to
-- speak to that person.
--
-- run_momenti_matcher() and get_momenti_deck() are both SECURITY DEFINER, so neither inherits
-- the RLS added in 20260818114947 and neither has any ban check today: run_momenti_matcher gates
-- pairs on athanor.pair_not_blocked and nothing else.
--
-- Two halves, because they fail at different times:
--   • the MATCHER stops writing new proposals — either direction, a banned member neither
--     receives a deck nor appears in one.
--   • the DECK stops serving proposals that were already written before the ban landed. Without
--     this half a ban would take up to a full nightly cycle to clear the decks it is already in.
--
-- Direct `banned_at is null` reads rather than athanor.not_banned(): both functions are DEFINER
-- and already read profiles columns directly, and not_banned() is true for one's OWN uid, which
-- is the wrong shape for the recipient arm of a matcher (it happens to be moot under cron, where
-- auth.uid() is null, but relying on that would be an accident rather than a rule).
--
-- Bodies are otherwise byte-for-byte 20260817165404's; `create or replace` throughout, since
-- neither signature nor OUT list changes and both ACLs therefore survive.

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
     where p.banned_at is null                                    -- #314
       and exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
       and c.today_count < 3
       -- the deck is at most three WAITING cards, not three new ones a night (#273 B)
       and c.pending_count < 3
  ),
  pairs as materialized (
    select r.user_id, r.today_count, r.pending_count, c.id as candidate_id
      from recipients r
      join public.profiles c on c.id <> r.user_id
     where c.banned_at is null                                    -- #314
       and exists (select 1 from public.dreams d
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
     where p.banned_at is null                                    -- #314
       and exists (select 1 from public.dreams d
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
     where c.banned_at is null                                    -- #314
       and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
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

-- Re-issued so this file states the whole privilege surface it leaves behind. The matcher is
-- cron-only: no client role may call it.
revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;


-- The deck: a proposal written before the ban must stop rendering immediately. Sits beside the
-- existing not_blocked gate, which it deliberately mirrors.
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
    and c.banned_at is null                                          -- #314
    and athanor.field_visible(c.id, 'dream')
  -- #273 B: newest DAY first, then the rank within that day.
  order by mp.proposed_on desc, mp.daily_rank asc
  limit 3;
$$;

revoke execute on function public.get_momenti_deck() from public, anon;
grant execute on function public.get_momenti_deck() to authenticated;
