-- #273 B, second half: cap the matcher on the recipient's PENDING backlog, not only on
-- today's insert count.
--
-- 20260812145446 fixed the two halves of the stale-deck problem that #273 names — the deck now
-- orders (proposed_on desc, daily_rank asc), and pending proposals expire after 7 days — but it
-- left the cap itself counting only rows written TODAY. A member holding three unswiped cards
-- therefore still collected three more every night, and each of those inserts fires the
-- «Hai un Momento» push (public.on_momento_proposal_push, 20260701160235 L174-188). The
-- consequence is not just a stale deck: it is a nightly push to the person least likely to want
-- one, and three more pairs burned out of the candidate pool for a deck that already has cards.
--
-- «Pochi, curati, rilevanti» (momenti.sub) is a claim about the DECK, so the cap has to be about
-- the deck: at most three waiting Momenti, full stop. A member who does not swipe gets nothing
-- new until they do — or until the 7-day expiry frees the slot.
--
-- Separate migration rather than an edit: 20260812145446 is applied (rule 7), and re-pushing an
-- edited file would silently not re-run.
--
-- Everything else about the matcher — the seeking→identity expansion, the affinity ≥ 2
-- threshold, the dream-recency fallback, the visibility and block predicates, no reason prose —
-- is unchanged from that migration; only the two count predicates and the insert guard move.
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
    select p.id as user_id, p.identity_tags, p.seeking, c.today_count, c.pending_count
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
           -- … and you are what they seek.
           athanor.tag_intersect(r.identity_tags, athanor.seeking_to_identity(c_seek.v)) as offer_hit
      from recipients r
      join public.profiles c on c.id <> r.user_id
      cross join lateral (select case when coalesce(c.visibility ->> 'identity_tags', 'members') <> 'private'
                                      then c.identity_tags else '{}'::text[] end as v) c_tags
      cross join lateral (select case when coalesce(c.visibility ->> 'seeking', 'members') <> 'private'
                                      then c.seeking else '{}'::text[] end as v) c_seek
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
           (coalesce(array_length(shared,1),0)
            + coalesce(array_length(seek_hit,1),0)
            + coalesce(array_length(offer_hit,1),0))::numeric as affinity
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
   -- pending_count is the new ceiling on what the member is actually holding.
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
  'Nightly Momenti matcher (03:11 UTC cron). Scores each recipient×candidate pair on three '
  'terms — shared identity, their identity answering your seeking, your identity answering '
  'theirs (#273 A) — above an affinity threshold of 2 (#273 C). The cap is at most 3 WAITING '
  'proposals and at most 3 written per day (#273 B): a member holding an unswiped deck gets '
  'nothing new, and no push, until they swipe or the 7-day expiry frees a slot. A recipient the '
  'pass leaves with an empty deck gets one dream-recency card at affinity 0 instead (#273 E). '
  'Writes NO reason prose: get_momenti_deck() computes the terms at read time (#273 D).';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;
