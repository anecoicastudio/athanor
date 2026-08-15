-- #215 — Migration slice (i): cycle shape — phases, windows, declared minimums.
-- FUND-15, FUND-42, FUND-43, FUND-46 · divergence D-1…D-5 (partial: D-5's closure columns are
-- slice iii, #216/#221) · decisions D2, D3, D7, D15 (docs/FUND-DECISIONS.md).
--
-- fund_editions stops being an annual edition and becomes an event-driven cycle:
--   • `year` and the per-year active index go; ONE cycle may be non-closed globally.
--   • phase vocabulary: candidacy | screening | voting | announcement | realization | closed.
--   • the ballot window exists as data (voting_starts_at / voting_ends_at); #217 enforces it.
--   • three deferred per-cycle minimums, NOT NULL and deliberately DEFAULT-less (FUND-SPEC §5):
--     a cycle physically cannot open until an operator chooses them. Do not add a default.
--   • the declared economics columns (split_pct, cost_fee_statement, equity_declared) exist as
--     nullable shape only — #232 owns their frozen-at-open semantics and will tighten them.

-- ── 1. Phase vocabulary (D3) ────────────────────────────────────────────────────────────
-- Order matters: the old CHECK forbids the new values and the new CHECK forbids the old,
-- so drop → map data → re-add. Existing rows exist only on staging (the seeded fake world;
-- production carries no fund_editions row — FUND-SPEC §6 launch state). The map:
--   community  → voting     (behaviour-preserving: 'community' was the votable phase —
--                            cast_vote gated on it, fund.phase.community.d = «I voti dei
--                            membri» — and staging's world row sits there with seeded votes)
--   reputation → screening  (D3: ethics folds into screening)
--   ethics     → screening
--   event      → announcement
--   closed     → closed
alter table public.fund_editions drop constraint fund_editions_phase_check;

update public.fund_editions
   set phase = case phase
     when 'community'  then 'voting'
     when 'reputation' then 'screening'
     when 'ethics'     then 'screening'
     when 'event'      then 'announcement'
     else phase
   end;

alter table public.fund_editions
  alter column phase set default 'candidacy';

alter table public.fund_editions
  add constraint fund_editions_phase_check check (
    phase in ('candidacy','screening','voting','announcement','realization','closed')
  );

-- ── 2. Ballot window (FUND-15, D7) — data now, enforcement in #217 ──────────────────────
alter table public.fund_editions
  add column voting_starts_at timestamptz,
  add column voting_ends_at timestamptz,
  add constraint fund_editions_voting_window_check check (
    voting_starts_at is null or voting_ends_at is null or voting_ends_at > voting_starts_at
  );

comment on column public.fund_editions.voting_starts_at is
  'Ballot opens (FUND-15). Published at cycle open; cast_vote enforces the window in #217.';
comment on column public.fund_editions.voting_ends_at is
  'Ballot closes (FUND-15). Ties break on raw distinct-voter count, then earliest submission (D7).';

-- ── 3. The three deferred minimums (FUND-42/43/15, FUND-SPEC §5) ────────────────────────
-- NOT NULL with NO DEFAULT is the forcing function: you cannot set a quorum for a community
-- whose size you do not know, so someone must choose these numbers at the moment a cycle
-- opens, when there is information to choose with. ADD COLUMN … NOT NULL cannot land on a
-- non-empty table, so: add nullable → backfill the known staging rows with explicit, chosen
-- values → SET NOT NULL. The column definitions stay default-less; the backfill is a choice
-- for known fake-world rows, not a default.
alter table public.fund_editions
  add column min_funding_cents bigint,
  add column min_voters integer,
  add column min_candidacies integer;

-- Staging's seeded 2027 world row (seed-staging.sql §12) is the only pre-existing row anywhere
-- (production is empty). Values chosen for a walkable fake world: floor €1.000 against the
-- €50.000 goal, quorum 5 (the seed casts 6 votes → decisive), 3 screened candidacies (D7's
-- working assumption; the seed holds exactly 3).
update public.fund_editions
   set min_funding_cents = coalesce(min_funding_cents, 100000),
       min_voters        = coalesce(min_voters, 5),
       min_candidacies   = coalesce(min_candidacies, 3);

alter table public.fund_editions
  alter column min_funding_cents set not null,
  alter column min_voters set not null,
  alter column min_candidacies set not null,
  add constraint fund_editions_min_funding_cents_check check (min_funding_cents >= 0),
  add constraint fund_editions_min_voters_check check (min_voters > 0),
  add constraint fund_editions_min_candidacies_check check (min_candidacies > 0);

comment on column public.fund_editions.min_funding_cents is
  'FUND-42 funding floor, absolute cents, declared at open. Below it at the announcement snapshot the cycle voids. NOT NULL, no default — deliberately deferred per cycle (FUND-SPEC §5).';
comment on column public.fund_editions.min_voters is
  'FUND-43 turnout quorum, absolute count, declared at open. Below it the tally is not decisive. NOT NULL, no default — deliberately deferred per cycle (FUND-SPEC §5).';
comment on column public.fund_editions.min_candidacies is
  'FUND-15 minimum screened candidacies, declared at open. Below it the ballot does not open. NOT NULL, no default — deliberately deferred per cycle (FUND-SPEC §5).';

-- ── 4. Declared economics — shape only; #232 owns the frozen-at-open semantics ──────────
alter table public.fund_editions
  add column split_pct integer,
  add column cost_fee_statement text,
  add column equity_declared text,
  add constraint fund_editions_split_pct_check check (
    split_pct is null or (split_pct between 0 and 100)
  );

comment on column public.fund_editions.split_pct is
  'FUND-27/D15: the percentage Athanor retains this cycle (dream share = 100 − split_pct). Per-cycle data, never a constant; #232 freezes it at open. Cycle one declares 10, knowingly subsidised (D16).';
comment on column public.fund_editions.cost_fee_statement is
  'FUND-27: the declared operating-costs and service-fees statement for this cycle, published before the collection opens (#232).';
comment on column public.fund_editions.equity_declared is
  'FUND-30/D15: any equity participation, declared before contributions open — the instrument is negotiated inside what was declared, never outside it (#232).';

-- ── 5. One active cycle, globally (D2) ──────────────────────────────────────────────────
-- The old invariant was per-year; cycles are event-driven now, so the invariant is global:
-- at most one non-closed row. Partial unique index on a constant-per-row expression — every
-- indexed row carries `true`, so a second non-closed insert is a unique violation (23505).
drop index public.fund_editions_year_active;
alter table public.fund_editions drop column year;

create unique index fund_editions_one_active
  on public.fund_editions ((phase <> 'closed')) where phase <> 'closed';

comment on table public.fund_editions is
  'Dai Vita al Tuo Sogno — one event-driven cycle (the identifier stays fund_editions, D39). Public heartbeat (read), service-role write only. One non-closed cycle globally (fund_editions_one_active). contributions_enabled is the legal feature flag (PRD §4.11). The three min_* columns are NOT NULL with no default, deliberately (FUND-SPEC §5).';

-- ── 6. cast_vote: the phase literal follows the vocabulary ──────────────────────────────
-- 20260618131250 gated cast_vote on phase = 'community', a value step 1 just removed — left
-- alone the function would be dead code (voting closed forever). This replace changes ONLY
-- the literal to 'voting'. The ballot-window (now() in [voting_starts_at, voting_ends_at]),
-- quorum, and tie rules are #217's scope and land there; body otherwise verbatim from
-- 20260618131250 (security invoker, locked search_path, grants preserved by CREATE OR REPLACE).
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
  ) then
    raise exception 'voting closed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.dream_candidacies c
    where c.id = p_candidacy_id and c.edition_id = p_edition_id
      and c.deleted_at is null
      and c.status in ('submitted','screening','shortlisted','winner')
  ) then
    raise exception 'candidacy not votable' using errcode = 'P0001';
  end if;
  delete from public.candidacy_votes where voter_id = v_uid and edition_id = p_edition_id;
  insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
  values (p_edition_id, p_candidacy_id, v_uid);   -- weight defaults 0 → RLS ok → trigger snapshots the constant 1.000
end;
$$;
