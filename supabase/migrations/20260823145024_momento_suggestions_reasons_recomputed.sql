-- #124, review follow-up — momento_suggestions stops STORING reason kinds, and
-- get_momenti_suggestion() recomputes them per read.
--
-- A separate migration because 20260823141316 is already applied to staging and migrations are
-- append-only once applied (rule 7). Same PR, same feature; this file is the correction.
--
-- THE LEAK. The stored `reasons` array froze which of the seven terms had fired at 03:11 and the
-- read served it verbatim. The read re-checked `banned_at`, `field_visible(dream)` and the
-- both-tags-private composite — but NOT the field each stored kind was derived from. So a
-- candidate who made only `identity_tags` private after the run (leaving `seeking` visible, which
-- keeps the composite gate from firing) stayed in the list with a «Condividete» chip: the
-- suggestion went on telling the reader that the candidate's now-hidden tags overlap theirs,
-- until the next night's pass. The same class of leak M10 was written for — its own note names
-- "run_momenti_matcher surfaced private tags as match reasons" — and the reason
-- get_momenti_deck() recomputes its terms live rather than reading a snapshot.
--
-- The fix is the ruling that already exists. #273 D removed stored reason prose from
-- momento_proposals for this exact reason, and 0028 asserts the column stays empty forever;
-- storing kinds here was the same mistake one representation over. So the column goes, and the
-- read projects athanor.momento_terms() — one engine, evaluated against live, masked fields.
--
-- What stays stored is `affinity`, and that is the point of the table rather than an
-- inconsistency: the RANKING is the nightly snapshot PRD §4.7 asks for («una piccola lista
-- curata, aggiornata ogni giorno»), exactly as momento_proposals.affinity is. What a row SAYS
-- must be current; which three rows there are may be a day old.
--
-- Consequence, deliberate: a suggestion whose terms have all since vanished now drops out of the
-- list at read time rather than rendering a chip it cannot justify — the same principle #384
-- settled for the deck ("a card must not score on a term it cannot display"). If that empties
-- the list, the cold-start arm answers and the section is still not empty.
--
-- Also here: the read re-checks `connections`. It was the one write-time gate the read did not
-- repeat, and it is the likeliest of all of them to change between the run and the read —
-- connecting is what a member DOES with a suggestion. Without it, tapping a suggestion through
-- to a connection left that person in «Ti potrebbe interessare» until the next night.

alter table public.momento_suggestions
  drop constraint momento_suggestions_reasons_nonempty,
  drop constraint momento_suggestions_reasons_vocabulary,
  drop column reasons;

comment on table public.momento_suggestions is
  'The nightly «Ti potrebbe interessare» list (#124): at most three affinity-ranked peers per '
  'active member per run, scored by athanor.momento_terms() in the same run_momenti_matcher() '
  'pass that writes momento_proposals. The RANKING is the snapshot; the reasons a row displays '
  'are recomputed per read by get_momenti_suggestion(), never stored — a frozen reason outlives '
  'the visibility it was derived from (#273 D, applied here). Read through '
  'get_momenti_suggestion(); service-role only, no client grant on any column.';

-- The matcher: same three passes, the third no longer computing an array it would only store.
-- Bodies of the two proposal passes are byte-for-byte 20260818115139's.
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

  -- ── suggestions pass (#124) ──
  -- DELETE then INSERT rather than an upsert: two unique constraints means ON CONFLICT can only
  -- infer one of them, and a re-run within the same day must be able to REMOVE a peer who has
  -- since been proposed, blocked or banned — an upsert would leave that row standing.
  delete from public.momento_suggestions where computed_on = v_today;

  with recipients as (
    -- Every active member, NOT only the ones with deck room: a member holding three waiting
    -- cards still has a «Ti potrebbe interessare» section to fill.
    select p.id as user_id
      from public.profiles p
     where p.banned_at is null
       and exists (select 1 from public.dreams d
                    where d.profile_id = p.id and d.status = 'active' and d.deleted_at is null)
  ),
  pairs as materialized (
    -- MATERIALIZED for the reason the proposals pass is: every gate that can reject a pair
    -- without scoring it sits here, and the planner must not hoist momento_terms() above them.
    select r.user_id, c.id as candidate_id
      from recipients r
      join public.profiles c on c.id <> r.user_id
     where c.banned_at is null
       and exists (select 1 from public.dreams d
                    where d.profile_id = c.id and d.status = 'active' and d.deleted_at is null)
       and coalesce(c.visibility ->> 'dream', 'members') <> 'private'
       -- Inline masking, never athanor.field_visible(): under cron there is no auth.uid() and
       -- that function's anon branch would mask every 'members' field away (#384 divergence D).
       --
       -- Both-tags-private excluded, matching what get_momenti_suggestion() has always done on
       -- the read side. It is a narrower rule than the proposals pass applies, and deliberately
       -- so: a Momento is a card with an ACTION on it, a suggestion is an invitation to go look
       -- at someone — a profile with both tag fields hidden has almost nothing to look at.
       and not (coalesce(c.visibility ->> 'identity_tags', 'members') = 'private'
            and coalesce(c.visibility ->> 'seeking', 'members') = 'private')
       and athanor.pair_not_blocked(r.user_id, c.id)
       -- Not in today's deck, and not passed inside the 90-day window. One predicate for both:
       -- a live proposal has passed_until null, a passed one has it set to +90d.
       and not exists (
             select 1 from public.momento_proposals mp
              where mp.user_id = r.user_id and mp.candidate_id = c.id
                and (mp.passed_until is null or mp.passed_until > v_today))
       -- Not already connected. NOTE this gate exists HERE only: whether the MATCHER should stop
       -- proposing connected pairs is still the open product question
       -- 20260814134451_momenti_mutual_activity_term.sql:14-17 records, and #124 does not settle
       -- it. Suggestions are a discovery surface, so the answer is unambiguous for them — «Ti
       -- potrebbe interessare» pointing at someone already in Connessioni wastes one of its
       -- three rows. The read repeats this gate, so a connection made during the day self-heals.
       and not exists (
             select 1 from public.connections cn
              where cn.profile_a = least(r.user_id, c.id)
                and cn.profile_b = greatest(r.user_id, c.id))
  ),
  scored as (
    select p.user_id, p.candidate_id, t.affinity
      from pairs p
      cross join lateral athanor.momento_terms(p.user_id, p.candidate_id) t
     -- No threshold: a suggestion is «guarda questa persona», not a card to answer, so one
     -- shared skill earns a row. But it must earn SOMETHING — affinity 0 means every term was
     -- empty, and a row with no reason has no honest chip to show. Those members fall through
     -- to get_momenti_suggestion()'s cold-start arm, which says «Sogno nuovo» and means it.
     where t.affinity > 0
  ),
  ranked as (
    select *, row_number() over (partition by user_id
                                 order by affinity desc, candidate_id) as rnk
      from scored
  )
  insert into public.momento_suggestions
        (user_id, candidate_id, affinity, computed_on, rank)
  select user_id, candidate_id, affinity, v_today, rnk::smallint
    from ranked
   where rnk <= 3;

  -- Keep a week of runs. The read serves the member's latest, so history is what makes a missed
  -- night degrade instead of blanking the section; a week is long enough for that and short
  -- enough that the table stays ~3 rows per active member.
  delete from public.momento_suggestions where computed_on < v_today - 7;

  return v_inserted + v_fallback;
end;
$$;

comment on function public.run_momenti_matcher() is
  'The nightly Momenti pass (cron momenti-matcher-nightly, 03:11 UTC). Writes momento_proposals '
  'in two passes — affinity, then the dream-recency fallback for a starving deck (#273 E) — and '
  'then momento_suggestions (#124), the «Ti potrebbe interessare» ranking, from the same '
  'athanor.momento_terms() scores. It stores the SCORE and the rank, never the reason kinds: '
  'the read recomputes those (#273 D). Returns the number of PROPOSALS written; suggestions are '
  'not counted. Cron-only: no client role may execute it.';

revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- The read: same OUT list, `reasons` now projected from live terms rather than read from the row.
drop function if exists public.get_momenti_suggestion(uuid[]);

create function public.get_momenti_suggestion(p_exclude uuid[] default '{}')
returns table (
  candidate_id uuid,
  handle text,
  display_name text,
  avatar_path text,
  dream_text text,
  reasons text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  -- Clamped: bounded work per call, and NULL-safe.
  v_exclude uuid[] := (coalesce(p_exclude, '{}'::uuid[]))[1:50];
begin
  if v_uid is null then
    return;
  end if;

  -- The member's LATEST run — today's rows when the night ran, yesterday's when it did not.
  -- At most three rows survive the limit, so this calls momento_terms() at most three times per
  -- read: the same shape and the same cost as get_momenti_deck().
  return query
  select s.candidate_id, p.handle, p.display_name, p.avatar_path, d.text, k.kinds
    from public.momento_suggestions s
    join public.profiles p on p.id = s.candidate_id
    join lateral (
      select dd.text
        from public.dreams dd
       where dd.profile_id = p.id
         and dd.status = 'active'
         and dd.deleted_at is null
       order by dd.created_at desc
       limit 1
    ) d on true
    -- Live and re-masked on every read, by the function the matcher scored with (#384). The
    -- score is deliberately not projected: a suggestion carries kinds, never a number (rule 3).
    cross join lateral athanor.momento_terms(v_uid, s.candidate_id) t
    cross join lateral (
      select array_remove(array[
               case when cardinality(t.shared)          > 0 then 'shared'         end,
               case when cardinality(t.seek_hit)        > 0 then 'seeking'        end,
               case when cardinality(t.offer_hit)       > 0 then 'offering'       end,
               case when cardinality(t.skills_shared)   > 0 then 'skills'         end,
               case when cardinality(t.city_near)       > 0 then 'city'           end,
               case when cardinality(t.mutual_activity) > 0 then 'mutualActivity' end,
               case when cardinality(t.profession_pair) > 0 then 'profession'     end
             ]::text[], null) as kinds
    ) k
   where s.user_id = v_uid
     and s.computed_on = (select max(s2.computed_on)
                            from public.momento_suggestions s2
                           where s2.user_id = v_uid)
     and not exists (select 1 from unnest(v_exclude) x where x = s.candidate_id)
     -- Re-checked at READ time, not trusted from the snapshot: a ban, a block, a visibility
     -- change or a new connection since the matcher ran must take the row out of the list now,
     -- the same way get_momenti_deck() re-checks a proposal written before a ban landed (#314).
     and p.banned_at is null
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
     and not exists (
           select 1 from public.connections cn
            where cn.profile_a = least(v_uid, s.candidate_id)
              and cn.profile_b = greatest(v_uid, s.candidate_id))
     -- A pick whose terms have ALL since vanished has nothing it can honestly say, so it leaves
     -- the list rather than rendering a chip it can no longer justify (#384's principle: a card
     -- must not score on a term it cannot display). If this empties the list, the cold-start arm
     -- below answers and the section is still not empty.
     and cardinality(k.kinds) > 0
   order by s.rank
   limit 3;

  if found then
    return;
  end if;

  -- Cold start: no run has produced a row for this member yet, or every one it produced has just
  -- been filtered out. The recency query this function used to BE, so the section is never empty
  -- — and «Sogno nuovo» is then an honest chip rather than a stand-in for a ranking that did not
  -- happen. No connections gate here: this arm has never had one, it claims no curation, and
  -- adding one is a product change #124 does not ask for.
  return query
  select p.id, p.handle, p.display_name, p.avatar_path, d.text, array['newDream']::text[]
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
   where p.id <> v_uid
     and not exists (select 1 from unnest(v_exclude) x where x = p.id)
     -- banned_at is NEW here, and it is a fix rather than a port: #314 closed this hole in the
     -- matcher and in the deck and never reached this function, so a banned member has been
     -- reachable through «Ti potrebbe interessare» ever since.
     and p.banned_at is null
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
   order by d.created_at desc
   limit 1;
end;
$$;

comment on function public.get_momenti_suggestion(uuid[]) is
  'The «Ti potrebbe interessare» list (#124): up to three peers from the member''s latest '
  'momento_suggestions run, in the run''s rank order, carrying the reason KINDS but never the '
  'score (rule 3). The kinds are RECOMPUTED per read from athanor.momento_terms() against live, '
  'visibility-masked fields — a stored reason outlives the field it was derived from (#273 D) — '
  'and a pick whose terms have all vanished leaves the list. Bans, blocks, dream visibility and '
  'connections are re-checked here too, so a nightly snapshot never outlives any of them. A '
  'member with no run yet falls back to the single most recently written visible active dream, '
  'tagged newDream — the behaviour this function had in full until #124. DEFINER because '
  'profiles.visibility is not readable by authenticated (M10 column grant).';

revoke execute on function public.get_momenti_suggestion(uuid[]) from public, anon;
grant execute on function public.get_momenti_suggestion(uuid[]) to authenticated;
