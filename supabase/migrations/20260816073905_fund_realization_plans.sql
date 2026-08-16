-- #228 — realization plans and their phases, plus the ledger linkage that makes a
-- released tranche attributable to the phase it funded.
-- FUND-25 (the plan's nine recorded items), FUND-53 (money spent according to the plan),
-- FUND-26 (progress, #230's surface) · docs/FUND-SPEC.md §"Realization" · the nine items
-- themselves are «Il Fondo dei Sogni della Community» §10 · divergence D-14.
--
-- WHAT THIS IS NOT: a second money ledger. #247's fund_payout_ledger (20260815215924) is
-- already "the tranche release ledger" this issue's third deliverable asked for — it
-- carries the tranche semantics («a returned tranche nets against what remains
-- unreleased», ruling #244, stated at 20260815215924:160) and close_cycle reads it as the
-- authoritative disbursed basis (20260815215924:230-236). The issue predates both, which
-- is why its prose still asks for a ledger. Two tables describing the same euros is the
-- defect class D-8/D-19 exist to record, so what was missing is only the LINKAGE:
-- fund_payout_ledger.plan_phase_id below, nullable because every row released before
-- plans existed has no phase and must stay representable.
--
-- STRUCTURED WHERE MONEY TOUCHES IT, PROSE ELSEWHERE. A tranche release reads exactly
-- three facts, so exactly those three are rows: the phase's date, its amount, and the
-- criteria its verification is judged against. Objective, professionals, suppliers and
-- expected result are what a human reads, never what a release computes, so they stay
-- prose columns on the plan. §10's nine items are all represented, and none of them is a
-- ninth column:
--   obiettivo del progetto    → realization_plans.objective          (prose)
--   budget disponibile        → fund_editions.confirmed_pool_cents   (NO COLUMN HERE — the
--                               #220 announcement snapshot is already one number in one
--                               place; copying it onto the plan is how two numbers
--                               describing one population begin. The phase-coherence
--                               trigger reads it live instead.)
--   costi previsti            → realization_plan_phases.amount_cents (per phase)
--   professionisti coinvolti  → realization_plans.professionals      (prose)
--   eventuali fornitori       → realization_plans.suppliers          (prose)
--   tempi di realizzazione    → realization_plan_phases.scheduled_for
--   fasi del progetto         → realization_plan_phases              (the rows themselves)
--   modalità di verifica      → realization_plan_phases.verification_criteria
--   risultato finale previsto → realization_plans.expected_result    (prose)
--
-- SEAMS LEFT OPEN ON PURPOSE. #229 owns authoring, publication and re-costing: nothing
-- here writes a plan except the service role. #230 owns progress. #231 owns the
-- verification gate — realization_plan_phases.verified_at is the slot its ladder will
-- read, and release-fund-payout's reserved refusal (logic.ts:111-117) is deliberately
-- NOT wired in this migration; the sweep stays inert by construction until #231 lands.
--
-- Zero Aura anywhere in this file (rule #1): authoring or completing a plan grants no
-- points, exactly as contributing money does not. Both tables join
-- aura-boundary.test.ts's MONEY_TABLES and pgTAP 0114 asserts it in-db.

-- ── 1. The plan ─────────────────────────────────────────────────────────────────────────
-- Bound to a cycle AND to the candidacy that won it. The binding is a trigger rather than
-- a composite FK to (fund_editions.id, winner_candidacy_id): that FK would be elegant, but
-- dream_candidacies deletion SET NULLs fund_editions.winner_candidacy_id (20260617225450
-- §4), which the #240 GDPR erasure path relies on — a composite FK would make an erasure
-- request fail on a cycle that has a plan, which is D-18 all over again.
--
-- ON DELETE CASCADE from the candidacy, by contrast, is exactly what erasure needs: the
-- plan is member-authored prose, so it goes when its author's candidacy goes. That also
-- means NO deleted_at here, and the omission is deliberate: a published plan is the public
-- commitment tranches release against (FUND-53). Withdrawing one is not a member gesture —
-- correcting it is #229's re-costing (an edit), and erasing it is the cascade above.
create table public.realization_plans (
  id uuid primary key default gen_random_uuid(),
  -- One plan per cycle. A cycle has one winner (fund_editions.winner_candidacy_id), so
  -- this unique IS "one plan per realized winner per cycle", stated where it cannot drift.
  edition_id uuid not null unique references public.fund_editions (id) on delete restrict,
  candidacy_id uuid not null references public.dream_candidacies (id) on delete cascade,
  -- Bounded prose. The upper bounds are CHECKs rather than a convention because this text
  -- is rendered on a public page (#237) and mirrored by a Zod schema: an unbounded column
  -- would let a row exist that its own schema refuses to parse.
  objective text not null
    check (btrim(objective) <> '' and char_length(objective) <= 4000),
  expected_result text not null
    check (btrim(expected_result) <> '' and char_length(expected_result) <= 4000),
  -- Recorded, not necessarily populated: a dream can genuinely have no suppliers. Empty
  -- string rather than NULL so "recorded as none" and "never filled in" are not two states.
  professionals text not null default '' check (char_length(professionals) <= 4000),
  suppliers text not null default '' check (char_length(suppliers) <= 4000),
  -- #229 sets this. Until it is set the plan is a draft: readable by its author and by an
  -- admin, invisible to the world. The public read policy below is the transparency
  -- surface #237/#230 render, and a draft is not yet a commitment.
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.realization_plans is
  '#228/FUND-25: the winner''s realization plan for one cycle — prose (objective, professionals, suppliers, expected result) plus phases as rows. «Budget disponibile» is NOT stored here: it is fund_editions.confirmed_pool_cents, read live. One plan per cycle (unique edition_id); bound to that cycle''s winning candidacy by trigger. Public-read once published, author + admin read a draft; written only by the service role (#229). Member-authored prose — CASCADEs with the candidacy on GDPR erasure, so no deleted_at. Zero Aura (rule #1).';

comment on column public.realization_plans.published_at is
  '#228/#229: null = draft (author + admin only). Set when the plan becomes the public commitment #237 renders and #231 releases tranches against.';

create index realization_plans_candidacy on public.realization_plans (candidacy_id);

create trigger realization_plans_touch_updated_at
  before update on public.realization_plans
  for each row execute function public.touch_updated_at();

-- ── 2. The phases ───────────────────────────────────────────────────────────────────────
-- The three facts a tranche release reads, one row per phase. `sort` orders them for
-- display and for "which tranche is next" (the screening_criteria idiom); `scheduled_for`
-- is the calendar fact («tempi») and is deliberately not assumed to follow `sort` — a plan
-- may schedule two phases on one date, and re-costing may reorder without re-dating.
create table public.realization_plan_phases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.realization_plans (id) on delete cascade,
  sort smallint not null check (sort > 0),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  scheduled_for date not null,
  -- «costi previsti». Strictly positive: a phase IS a tranche (FUND-SPEC §Realization,
  -- "money is released in tranches against the plan's phases"), and a zero-euro tranche is
  -- a progress note, which is #230's surface rather than a release unit.
  amount_cents bigint not null check (amount_cents > 0),
  verification_criteria text not null
    check (btrim(verification_criteria) <> '' and char_length(verification_criteria) <= 2000),
  -- #231's slot. Nothing in this migration writes it and nothing reads it yet; the
  -- verification gate is that issue's, and wiring it here would ship an ungated release.
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, sort)
);

comment on table public.realization_plan_phases is
  '#228/FUND-25/FUND-53: one row per plan phase — date, amount, verification criteria: exactly what a tranche release reads. The phase-coherence trigger caps the plan''s phase sum at the cycle''s declared payable, so a plan can never promise more than the money that exists. verified_at is #231''s gate slot, unwritten here. Public-read once the plan is published; service-write only. Zero Aura (rule #1).';

comment on column public.realization_plan_phases.verified_at is
  '#231: reserved. release-fund-payout''s refusal ladder will read this ("no verification, no money", FUND-53); until that issue lands nothing sets it and the #248 sweep stays inert by construction.';

-- No separate plan_id index: unique (plan_id, sort) already indexes that prefix, which is
-- what every read here does (a plan's phases, in order).

create trigger realization_plan_phases_touch_updated_at
  before update on public.realization_plan_phases
  for each row execute function public.touch_updated_at();

-- ── 3. The plan binds the cycle's confirmed winner ──────────────────────────────────────
-- Refuses before any write (the close_cycle / within_basis idiom): a plan for a candidacy
-- that did not win, or for a winner who never confirmed viability (#220), is not a plan
-- anyone may release money against.
create function public.realization_plans_binds_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_winner uuid;
  v_confirmed timestamptz;
begin
  select e.winner_candidacy_id, e.winner_confirmed_at into v_winner, v_confirmed
    from public.fund_editions e
   where e.id = new.edition_id
   for update;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_winner is null then
    raise exception 'no winner declared' using errcode = 'P0001';
  end if;
  if v_winner <> new.candidacy_id then
    raise exception 'plan does not bind the cycle winner' using errcode = 'P0001';
  end if;
  -- Realization never began without the winner's confirmation — close_cycle refuses on the
  -- same condition, and a plan is the thing realization consists of.
  if v_confirmed is null then
    raise exception 'viability not confirmed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger realization_plans_binds_winner
  before insert or update of edition_id, candidacy_id
  on public.realization_plans
  for each row execute function public.realization_plans_binds_winner();

-- ── 4. The phase sum never promises more money than exists ──────────────────────────────
-- The ceiling is the cycle's PAYABLE, not its pool: floor(confirmed_pool × (100 − split)
-- / 100) is what can ever reach the winner under the #232 declared retention, and it is
-- the same figure fund_payout_ledger caps releases at (ruling #244). Deriving both from
-- the same frozen columns is what keeps "the plan's costs" and "the money released" from
-- becoming two numbers about one population — a plan whose phases sum past payable would
-- be a published promise the release path is required to refuse.
--
-- Enforced at the database rather than only in #229's authoring path, for the reason
-- #244 gives: the executor is not the only thing that can write.
create function public.realization_plan_phases_within_payable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_edition uuid;
  v_pool bigint;
  v_split integer;
  v_payable bigint;
  v_others bigint;
begin
  select p.edition_id into v_edition
    from public.realization_plans p
   where p.id = new.plan_id;
  if not found then
    raise exception 'plan not found' using errcode = 'P0001';
  end if;
  -- FOR UPDATE on the edition row serializes concurrent phase inserts for one cycle, so
  -- two sessions cannot both pass the sum check (the fund_payout_ledger_within_basis lock).
  select e.confirmed_pool_cents, e.split_pct into v_pool, v_split
    from public.fund_editions e
   where e.id = v_edition
   for update;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_pool is null then
    raise exception 'no confirmed pool' using errcode = 'P0001';
  end if;
  v_payable := (v_pool * (100 - v_split)) / 100;
  select coalesce(sum(f.amount_cents), 0) into v_others
    from public.realization_plan_phases f
   where f.plan_id = new.plan_id
     and f.id <> new.id;
  if v_others + new.amount_cents > v_payable then
    raise exception 'phases exceed declared payable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger realization_plan_phases_within_payable
  before insert or update of amount_cents, plan_id
  on public.realization_plan_phases
  for each row execute function public.realization_plan_phases_within_payable();

-- ── 5. SRW posture, public read (the screening_criteria / fund tables pattern) ───────────
-- Hosted ALTER DEFAULT PRIVILEGES auto-grants client writes on new public tables, so a
-- blocked client write would silently affect 0 rows instead of raising 42501. Strip
-- everything, grant back exactly SELECT; #229 writes as service_role.
revoke all on table public.realization_plans from anon, authenticated;
grant select on table public.realization_plans to anon, authenticated;
grant all on table public.realization_plans to service_role;

revoke all on table public.realization_plan_phases from anon, authenticated;
grant select on table public.realization_plan_phases to anon, authenticated;
grant all on table public.realization_plan_phases to service_role;

alter table public.realization_plans enable row level security;
alter table public.realization_plan_phases enable row level security;

-- Published means published: #237's per-cycle page renders these signed-out (anon).
create policy "realization_plans_select_published"
  on public.realization_plans for select
  to anon, authenticated
  using (published_at is not null);

-- The author reads their own draft (#229's authoring screen), in any state.
create policy "realization_plans_select_own"
  on public.realization_plans for select
  to authenticated
  using (exists (
    select 1 from public.dream_candidacies c
     where c.id = candidacy_id
       and c.profile_id = (select auth.uid())
  ));

create policy "realization_plans_select_admin"
  on public.realization_plans for select
  to authenticated
  using ((select athanor.is_admin()));
-- NO insert/update/delete client policy: the plan is service-role written (#229).

-- Phases follow their plan's visibility, exactly — three policies mirroring the three
-- above so a phase can never be readable when its plan is not.
create policy "realization_plan_phases_select_published"
  on public.realization_plan_phases for select
  to anon, authenticated
  using (exists (
    select 1 from public.realization_plans p
     where p.id = plan_id
       and p.published_at is not null
  ));

create policy "realization_plan_phases_select_own"
  on public.realization_plan_phases for select
  to authenticated
  using (exists (
    select 1 from public.realization_plans p
     join public.dream_candidacies c on c.id = p.candidacy_id
     where p.id = plan_id
       and c.profile_id = (select auth.uid())
  ));

create policy "realization_plan_phases_select_admin"
  on public.realization_plan_phases for select
  to authenticated
  using ((select athanor.is_admin()));
-- NO write policies here either.

-- ── 6. The linkage: a released tranche knows which phase it funded ──────────────────────
-- Nullable, and it stays nullable forever: releases made before plans existed have no
-- phase, and #248's operator path can still release against a cycle that has no plan.
-- Attribution is a fact about a row, not a precondition for one.
--
-- ON DELETE SET NULL, not RESTRICT, for the reason the ledger's own header gives about
-- destination_account_id: money history must outlive the member content it points at. A
-- GDPR erasure deletes the candidacy, which CASCADEs the plan and its phases; RESTRICT
-- would make that erasure fail. The release row survives with its attribution cleared,
-- which is the honest state — the phase it funded no longer exists.
-- (Consequence #229 must respect: re-costing edits a funded phase, it does not delete and
-- re-create one, or the attribution is silently dropped.)
--
-- NOTHING POPULATES IT YET, and that is the honest state of this slice. The ledger's only
-- writer is stripe-webhook's transfer.created arm, which builds a row from the transfer's
-- Stripe metadata; carrying a phase there is #231's edit, made when release-fund-payout
-- learns which tranche is due. The column, its FK and the checks below exist first so that
-- issue adds one metadata key rather than a schema.
alter table public.fund_payout_ledger
  add column plan_phase_id uuid references public.realization_plan_phases (id) on delete set null;

comment on column public.fund_payout_ledger.plan_phase_id is
  '#228: the plan phase this transfer funded, or null — pre-plan releases and plan-less cycles are legitimate. The within-basis trigger refuses a phase from another cycle and caps this phase''s released-net at its amount_cents, so the attribution cannot lie.';

create index fund_payout_ledger_plan_phase
  on public.fund_payout_ledger (plan_phase_id)
  where plan_phase_id is not null;   -- partial: most rows carry no phase

-- The within-basis trigger grows the linkage checks. Replacing the function (append-only
-- applies to migration FILES, not to function definitions — the close_cycle precedent in
-- 20260815215924) keeps one home for "is this ledger row's basis coherent", and the
-- trigger is re-created only to add plan_phase_id to its UPDATE column list.
--
-- An attribution that can lie is worse than none: a phase from another cycle, or 10.000 €
-- attributed to a 5.000 € phase, would make #234's recorded costs and #237's published
-- figures disagree with the plan they both cite. Both are refused here.
create or replace function public.fund_payout_ledger_within_basis()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pool bigint;
  v_split integer;
  v_payable bigint;
  v_released_others bigint;
  v_phase_edition uuid;
  v_phase_amount bigint;
  v_phase_others bigint;
begin
  select e.confirmed_pool_cents, e.split_pct into v_pool, v_split
    from public.fund_editions e
   where e.id = new.edition_id
   for update;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_pool is null then
    raise exception 'no confirmed pool' using errcode = 'P0001';
  end if;
  if new.pool_cents <> v_pool or new.split_pct <> v_split then
    raise exception 'basis diverges from declared economics' using errcode = 'P0001';
  end if;
  v_payable := (v_pool * (100 - v_split)) / 100;
  select coalesce(sum(l.amount_cents - l.reversed_cents), 0) into v_released_others
    from public.fund_payout_ledger l
   where l.edition_id = new.edition_id
     and l.id <> new.id;
  if v_released_others + (new.amount_cents - new.reversed_cents) > v_payable then
    raise exception 'released exceeds declared payable' using errcode = 'P0001';
  end if;
  -- #228 linkage. Null is legal and checked first: the whole pre-plan corpus lands here.
  if new.plan_phase_id is not null then
    select p.edition_id, f.amount_cents into v_phase_edition, v_phase_amount
      from public.realization_plan_phases f
      join public.realization_plans p on p.id = f.plan_id
     where f.id = new.plan_phase_id;
    if not found then
      raise exception 'plan phase not found' using errcode = 'P0001';
    end if;
    if v_phase_edition <> new.edition_id then
      raise exception 'plan phase belongs to another cycle' using errcode = 'P0001';
    end if;
    select coalesce(sum(l.amount_cents - l.reversed_cents), 0) into v_phase_others
      from public.fund_payout_ledger l
     where l.plan_phase_id = new.plan_phase_id
       and l.id <> new.id;
    if v_phase_others + (new.amount_cents - new.reversed_cents) > v_phase_amount then
      raise exception 'released exceeds phase amount' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger fund_payout_ledger_within_basis on public.fund_payout_ledger;
create trigger fund_payout_ledger_within_basis
  before insert or update of amount_cents, reversed_cents, edition_id, pool_cents, split_pct,
                             plan_phase_id
  on public.fund_payout_ledger
  for each row execute function public.fund_payout_ledger_within_basis();
