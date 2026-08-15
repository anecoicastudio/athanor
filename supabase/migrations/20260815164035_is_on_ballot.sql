-- #383 — one definition of the ballot: is_on_ballot(dream_candidacies).
-- "Which candidacies are on the ballot" was answered by hand-copied status-set literals in
-- five live objects (the dream_candidacies_list_feed partial index, the
-- dream_candidacies_select_visible RLS policy, cast_vote, fund_editions_ballot_open_check,
-- declare_winner — the last with a deliberate divergence, dropping 'winner'). This migration
-- gives the set one home and points the five at it; #218's screening transition then narrows
-- ONE function instead of editing seven literals (20260815090015's header conceded exactly
-- this convergence).
--
-- Behaviour-preserving on purpose: the predicate is today's four-value votable set,
-- verbatim. The screened narrowing is #218's commit, not this one.

-- ── 1. The predicate ────────────────────────────────────────────────────────────────────
-- IMMUTABLE is load-bearing twice over: (a) Postgres requires it of any function in a
-- partial-index predicate; (b) it means a future body change (e.g. #218's narrowing)
-- INVALIDATES the dream_candidacies_list_feed index semantics — whoever changes this body
-- must drop and re-create that index in the same migration, or the index keeps serving the
-- old set. No SET search_path, deliberately: the body references only its row argument
-- (no object lookups to hijack), and leaving it off keeps the SQL body inlinable into the
-- RLS policy and query plans — a per-row policy call must not pay function-call overhead.
create function public.is_on_ballot(c public.dream_candidacies)
returns boolean
language sql
immutable
as $$
  select c.deleted_at is null
     and c.status in ('submitted','screening','shortlisted','winner')
$$;

comment on function public.is_on_ballot(public.dream_candidacies) is
  '#383: THE definition of "on the ballot" — visible field, votable set, ballot minimum, and (composed with status <> ''winner'') declaration eligibility all read from here. IMMUTABLE + used in a partial-index predicate: any body change must drop/re-create dream_candidacies_list_feed in the same migration. #218 narrows this to the screened set.';

-- Callable wherever the row is readable; the function itself reveals nothing RLS hides
-- (it is a pure function of a row the caller already holds).
grant execute on function public.is_on_ballot(public.dream_candidacies) to anon, authenticated, service_role;

-- ── 2. The five call sites ──────────────────────────────────────────────────────────────

-- (a) list-feed partial index (was 20260617225450:65-67, literal set)
drop index public.dream_candidacies_list_feed;
create index dream_candidacies_list_feed
  on public.dream_candidacies (edition_id, created_at desc, id desc)
  where public.is_on_ballot(dream_candidacies);

-- (b) RLS select (was 20260617225450:83-91). Same name — 0091's exhaustive policies_are
-- lists survive. Own-row visibility (any status, incl. rejected) unchanged; the public
-- branch is now the predicate. The two arms restate deleted_at each because is_on_ballot
-- owns it for the public branch while the own branch must still hide soft-deleted rows.
drop policy "dream_candidacies_select_visible" on public.dream_candidacies;
create policy "dream_candidacies_select_visible"
  on public.dream_candidacies for select
  to authenticated
  using (
    ((select auth.uid()) = profile_id and deleted_at is null)
    or public.is_on_ballot(dream_candidacies)
  );

-- (c) cast_vote (live body: 20260815090015). Only the candidacy predicate changes — the
-- window gate, delete+insert, and posture (invoker, locked search_path, grants preserved
-- by CREATE OR REPLACE) are verbatim.
create or replace function public.cast_vote(p_edition_id uuid, p_candidacy_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fund_editions e
    where e.id = p_edition_id and e.phase = 'voting'
      and now() >= e.voting_starts_at
      and now() <= e.voting_ends_at
  ) then
    raise exception 'voting closed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.dream_candidacies c
    where c.id = p_candidacy_id and c.edition_id = p_edition_id
      and public.is_on_ballot(c)
  ) then
    raise exception 'candidacy not votable' using errcode = 'P0001';
  end if;
  delete from public.candidacy_votes where voter_id = v_uid and edition_id = p_edition_id;
  insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
  values (p_edition_id, p_candidacy_id, v_uid);   -- weight defaults 0 → RLS ok → trigger snapshots the constant 1.000
end;
$$;

-- (d) ballot-open trigger function (live body: 20260815090015). Only the count predicate
-- changes; UPDATE-only binding and posture unchanged (trigger itself untouched).
create or replace function public.fund_editions_ballot_open_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.voting_starts_at is null or new.voting_ends_at is null then
    raise exception 'ballot window not declared' using errcode = 'P0001';
  end if;
  if (
    select count(*)
    from public.dream_candidacies c
    where c.edition_id = new.id
      and public.is_on_ballot(c)
  ) < new.min_candidacies then
    raise exception 'ballot minimum not met' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- (e) declare_winner (live body: 20260815094157). Its three-value set was the ONE
-- deliberate divergence — 'winner' excluded so a re-declaration cannot land. Stated once
-- now, where it is deliberate: is_on_ballot(c) AND status <> 'winner'. Everything else
-- (refusal ladder, fail-closed window arm, atomic writes, audit row) is verbatim.
create or replace function public.declare_winner(p_edition_id uuid)
returns table (candidacy_id uuid, vote_count bigint, weighted_total numeric, is_winner boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_winner uuid;
  v_voters integer;
  v_raised bigint;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent declarations serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_edition.winner_candidacy_id is not null then
    raise exception 'winner already declared' using errcode = 'P0001';
  end if;
  if v_edition.phase not in ('voting', 'announcement') then
    raise exception 'declaration out of phase' using errcode = 'P0001';
  end if;
  -- An undeclared window cannot close; the NULL arm is explicit because IF NULL is false.
  if v_edition.voting_ends_at is null or now() <= v_edition.voting_ends_at then
    raise exception 'ballot not closed' using errcode = 'P0001';
  end if;

  -- FUND-43 quorum. count(*) would equal count(distinct) under candidacy_votes_one_per_edition;
  -- distinct states the rule being enforced.
  select count(distinct v.voter_id) into v_voters
    from public.candidacy_votes v where v.edition_id = p_edition_id;
  if v_voters < v_edition.min_voters then
    raise exception 'quorum not met' using errcode = 'P0001';
  end if;

  -- FUND-42 funding floor, from source rows (rule 6: fund_aggregates is a derived cache).
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  if v_raised < v_edition.min_funding_cents then
    raise exception 'funding floor not met' using errcode = 'P0001';
  end if;

  -- Top eligible ballot row: on the ballot, minus the deliberate exception — 'winner'
  -- cannot win again (#383; the already-declared refusal above fires first anyway).
  select t.candidacy_id into v_winner
    from public.candidacy_tally(p_edition_id) with ordinality as t(candidacy_id, vote_count, weighted_total, rank)
    join public.dream_candidacies c on c.id = t.candidacy_id
   where public.is_on_ballot(c) and c.status <> 'winner'
   order by t.rank
   limit 1;
  if v_winner is null then
    raise exception 'no votable candidacy' using errcode = 'P0001';
  end if;

  -- The atomic pair + the audit row — one transaction, so a failure in any statement
  -- (e.g. the one-winner index) rolls back all three. Edition first: pgTAP 0103 forces the
  -- candidacy write to fail and asserts the edition write did not survive it.
  update public.fund_editions e
     set winner_candidacy_id = v_winner
   where e.id = p_edition_id;
  update public.dream_candidacies c
     set status = 'winner'
   where c.id = v_winner;
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'declare_winner', p_edition_id, v_winner,
          format('distinct voters %s (min %s), pool %s cents (min %s)',
                 v_voters, v_edition.min_voters, v_raised, v_edition.min_funding_cents));

  -- FUND-38/D9: the full ballot ordering, winner flagged. Aggregates only (rule #3).
  return query
    select t.candidacy_id, t.vote_count, t.weighted_total, t.candidacy_id = v_winner
      from public.candidacy_tally(p_edition_id) with ordinality
             as t(candidacy_id, vote_count, weighted_total, rank)
     order by t.rank;
end;
$$;
