-- #124 — «Ti potrebbe interessare» stops ranking by newest dream.
--
-- The M5 suggestions table was deferred, so get_momenti_suggestion() has ranked ONE peer by
-- dream recency ever since — which is why its chip says «Sogno nuovo» rather than naming an
-- overlap. The table lands here and the nightly matcher fills it from the SAME scores the deck
-- is built on: athanor.momento_terms() (#384). There is no second scoring path, no TS mirror,
-- and no new weight — packages/core/src/onboarding/affinity.ts keeps holding the rulings and
-- the tunables, athanor.momento_affinity_constants() keeps holding their values.
--
-- Four of the PRD §4.7 five families score today (identity/seeking tags, skills, city
-- proximity, mutual activity, complementary professions — the dream-keyword ↔ skills term is
-- still deferred in #361). That is four more than recency, which is the whole point.
--
-- WHY A TABLE AND NOT A LIVE RPC. Scoring is O(candidates) per member and calls
-- momento_terms() once per pair; doing it inside a request would put a full pair scan on the
-- Momenti tab's first paint. PRD §4.7 asks for «una piccola lista curata, aggiornata ogni
-- giorno» — a nightly snapshot IS the product, not a cache of something live.
--
-- ── Ordering of the three passes in run_momenti_matcher() ──
-- The suggestions pass runs THIRD, after both proposal passes, and reads their writes: a
-- candidate proposed tonight is in today's deck and must not also appear under «Ti potrebbe
-- interessare». Statements inside one transaction see earlier statements' rows, so the plain
-- `not exists (… momento_proposals …)` gate below is enough. It could NOT be folded into a
-- data-modifying CTE beside the insert it depends on: CTEs share one snapshot, so the
-- suggestions arm would not see the proposals the same statement had just written.
--
-- Cost: the suggestions pass is a second pair scan. It cannot reuse the proposals pass's
-- `pairs` CTE, whose recipient set is gated on deck capacity (today_count/pending_count < 3) —
-- suggestions are computed for every active member, including the ones holding a full deck.
-- Sharing the scan would have meant a temp table across statements inside a plpgsql function,
-- which caches plans against a relation that is dropped every call; the second scan is the
-- cheaper failure mode. Both passes are already O(n²) in active members and neither is
-- launch-scale — that is the matcher's standing problem, not this change's.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────────────────────
-- SERVICE-ROLE ONLY, no client grant of any kind. The issue sketched momento_proposals'
-- column-scoped recipe (grant SELECT on every column except `affinity`); this is narrower and
-- it costs the client nothing, because the client never selects this table. It cannot: a
-- suggestion renders a handle, a display name, an avatar and a dream, and profiles.visibility
-- has carried no client SELECT grant since the M10 column grant — the row is only assemblable
-- inside a DEFINER function, which is exactly what get_momenti_suggestion() is.
--
-- Keeping the whole table off the client ACL also leaves #405's column-ACL count at seven.
-- A column-scoped grant here would have made it eight and put a third table on the list
-- `revoke all on table` must never touch, in exchange for a SELECT nothing calls.
create table public.momento_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- The member the list is FOR. `user_id`/`candidate_id` rather than member/candidate, so the
  -- pair reads the same way it does on momento_proposals.
  user_id uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  -- Server-only, exactly as momento_proposals.affinity is: no client grant reaches it, and it
  -- is absent from @athanor/schemas. Rule 3 — a suggestion never renders a number.
  affinity numeric not null,
  -- The reason KINDS that fired, in athanor.momento_terms()'s own column order. Which one a
  -- 1-line chip shows is display policy and stays in packages/core (REASON_PRIORITY /
  -- rankReasons), so the deck and this list can never disagree about what outranks what.
  -- The vocabulary is @athanor/schemas' momentoReasonKind; 'newDream' is in the CHECK because
  -- it is part of that vocabulary, but it is never STORED — it is the read-side cold-start
  -- fallback's chip, and a stored row always has a real term.
  reasons text[] not null,
  computed_on date not null,
  rank smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint momento_suggestions_not_self check (user_id <> candidate_id),
  constraint momento_suggestions_affinity_positive check (affinity > 0),
  constraint momento_suggestions_rank_range check (rank between 1 and 3),
  constraint momento_suggestions_reasons_nonempty check (cardinality(reasons) > 0),
  constraint momento_suggestions_reasons_vocabulary check (
    reasons <@ array['shared', 'seeking', 'offering', 'skills',
                     'city', 'mutualActivity', 'profession', 'newDream']::text[]),
  -- One row per pair per run …
  constraint momento_suggestions_pair_per_run unique (user_id, candidate_id, computed_on),
  -- … and one row per rank per run, which is also the read's access path: the newest run for
  -- one member, in rank order.
  constraint momento_suggestions_rank_per_run unique (user_id, computed_on, rank)
);

comment on table public.momento_suggestions is
  'The nightly «Ti potrebbe interessare» list (#124): at most three affinity-ranked peers per '
  'active member per run, scored by athanor.momento_terms() in the same run_momenti_matcher() '
  'pass that writes momento_proposals. Read through get_momenti_suggestion(); service-role '
  'only, no client grant on any column. Snapshot, not a cache — PRD §4.7 asks for a small '
  'curated list refreshed daily.';

comment on column public.momento_suggestions.affinity is
  'The momento_terms() score at computation time. Server-only, like momento_proposals.affinity: '
  'no client grant reaches it and no surface renders it (rule 3).';

comment on column public.momento_suggestions.reasons is
  'The reason kinds that fired, in momento_terms() column order — display order is decided by '
  'packages/core REASON_PRIORITY at render time, not here.';

comment on column public.momento_suggestions.computed_on is
  'The UTC date of the matcher run that wrote the row. The read serves the member''s LATEST run, '
  'so a missed night degrades to yesterday''s list rather than to an empty section.';

create trigger momento_suggestions_touch_updated_at
  before update on public.momento_suggestions
  for each row execute function public.touch_updated_at();

-- The cascade path. Both unique constraints already index user_id-first; candidate_id has no
-- index of its own, and a profile deletion would seq-scan without one.
create index momento_suggestions_candidate_id_idx
  on public.momento_suggestions (candidate_id);

revoke all on table public.momento_suggestions from anon, authenticated;
grant all on table public.momento_suggestions to service_role;

alter table public.momento_suggestions enable row level security;
-- No client policies: service role only, same posture as push_receipts and
-- stripe_webhook_events. The client's only path is get_momenti_suggestion(), which is DEFINER.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. The matcher grows a third pass
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Signature unchanged, so `create or replace` and the ACL survives. The two proposal passes
-- are byte-for-byte 20260818115139's; everything after `-- ── suggestions pass ──` is new.
--
-- The return value still counts PROPOSALS only. It is what 0028 asserts and what the cron job
-- logs, and a number that silently started counting two different kinds of row would make
-- every historical reading of it wrong.
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
  -- DELETE then INSERT rather than an upsert: two unique constraints means ON CONFLICT can
  -- only infer one of them, and a re-run within the same day must be able to REMOVE a peer
  -- who has since been proposed, blocked or banned — an upsert would leave that row standing.
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
       -- Not already connected. NOTE this gate exists HERE only: whether the MATCHER should
       -- stop proposing connected pairs is still the open product question
       -- 20260814134451_momenti_mutual_activity_term.sql:14-17 records, and #124 does not
       -- settle it. Suggestions are a discovery surface, so the answer is unambiguous for
       -- them — «Ti potrebbe interessare» pointing at someone already in Connessioni is a
       -- list that wasted one of its three rows.
       and not exists (
             select 1 from public.connections cn
              where cn.profile_a = least(r.user_id, c.id)
                and cn.profile_b = greatest(r.user_id, c.id))
  ),
  scored as (
    select p.user_id, p.candidate_id, t.affinity,
           -- The kinds that fired, in momento_terms()'s own column order. NOT ordered by
           -- REASON_PRIORITY here: that policy lives once, in packages/core, and is applied
           -- at render — the same place the deck applies it.
           array_remove(array[
             case when cardinality(t.shared)          > 0 then 'shared'         end,
             case when cardinality(t.seek_hit)        > 0 then 'seeking'        end,
             case when cardinality(t.offer_hit)       > 0 then 'offering'       end,
             case when cardinality(t.skills_shared)   > 0 then 'skills'         end,
             case when cardinality(t.city_near)       > 0 then 'city'           end,
             case when cardinality(t.mutual_activity) > 0 then 'mutualActivity' end,
             case when cardinality(t.profession_pair) > 0 then 'profession'     end
           ]::text[], null) as reasons
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
        (user_id, candidate_id, affinity, reasons, computed_on, rank)
  select user_id, candidate_id, affinity, reasons, v_today, rnk::smallint
    from ranked
   where rnk <= 3;

  -- Keep a week of runs. The read serves the member's latest, so history is what makes a
  -- missed night degrade instead of blanking the section; a week is long enough for that and
  -- short enough that the table stays ~3 rows per active member.
  delete from public.momento_suggestions where computed_on < v_today - 7;

  return v_inserted + v_fallback;
end;
$$;

comment on function public.run_momenti_matcher() is
  'The nightly Momenti pass (cron momenti-matcher-nightly, 03:11 UTC). Writes momento_proposals '
  'in two passes — affinity, then the dream-recency fallback for a starving deck (#273 E) — and '
  'then momento_suggestions (#124), the «Ti potrebbe interessare» list, from the same '
  'athanor.momento_terms() scores. Returns the number of PROPOSALS written; suggestions are not '
  'counted. Cron-only: no client role may execute it.';

-- Re-issued so this file states the whole privilege surface it leaves behind.
revoke execute on function public.run_momenti_matcher() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. The read: get_momenti_suggestion becomes a list with reasons
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Return type changes (a sixth column, `reasons`), so drop and recreate; the ACL goes with the
-- old function and is re-granted below. @athanor/schemas' momentoSuggestion,
-- packages/api/src/momenti.ts and 0087 change in the same commit.
--
-- plpgsql rather than sql because the cold start is a genuine fallback, not a union: a member
-- with no suggestions row at all — a brand-new account before the first nightly pass, or one
-- for whom no candidate scored — still gets a peer, and RETURN QUERY sets FOUND, which is the
-- cheapest honest way to say «if the ranked list came back empty».
--
-- Every column reference below is qualified. The OUT parameters of `returns table` are
-- plpgsql variables, and `handle` / `reasons` / `rank` all name real columns of the tables in
-- scope — an unqualified one would either resolve to the variable or raise ambiguity at first
-- execution rather than at create time.
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
  return query
  select s.candidate_id, p.handle, p.display_name, p.avatar_path, d.text, s.reasons
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
   where s.user_id = v_uid
     and s.computed_on = (select max(s2.computed_on)
                            from public.momento_suggestions s2
                           where s2.user_id = v_uid)
     and not exists (select 1 from unnest(v_exclude) x where x = s.candidate_id)
     -- Re-checked at READ time, not trusted from the snapshot: a ban, a block or a
     -- visibility change since the matcher ran must take the row out of the list now, the
     -- same way get_momenti_deck() re-checks a proposal written before a ban landed (#314).
     and p.banned_at is null
     and athanor.field_visible(p.id, 'dream')
     and not (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
          and coalesce(p.visibility ->> 'seeking', 'members') = 'private')
   order by s.rank
   limit 3;

  if found then
    return;
  end if;

  -- Cold start: no run has produced a row for this member yet, or every one it produced has
  -- just been filtered out. The recency query this function used to BE, so the section is
  -- never empty — and «Sogno nuovo» is then an honest chip rather than a stand-in for a
  -- ranking that did not happen.
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
  'The «Ti potrebbe interessare» list (#124): up to three affinity-ranked peers from the '
  'member''s latest momento_suggestions run, in rank order, carrying the reason KINDS but never '
  'the score (rule 3). Bans, blocks and visibility are re-checked at read time, so a snapshot '
  'never outlives them. A member with no run yet falls back to the single most recently written '
  'visible active dream, tagged newDream — the behaviour this function had in full until now. '
  'DEFINER because profiles.visibility is not readable by authenticated (M10 column grant).';

revoke execute on function public.get_momenti_suggestion(uuid[]) from public, anon;
grant execute on function public.get_momenti_suggestion(uuid[]) to authenticated;
