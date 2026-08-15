-- #225 — Migration slice (ii): candidacy budget, minimum, skills, category, dream link.
-- FUND-09, FUND-10, FUND-50, part of FUND-11 · divergence D-9, D-10, D-24 · decisions
-- D10–D13, D43 (docs/FUND-DECISIONS.md).
--
-- The budget existed only as prose inside `plan` — unqueryable, unvalidatable, incomparable
-- across candidates, and it is the number the community is being asked to fund. This slice
-- makes the proposal structured where the ballot needs it:
--   • budget_cents — what the dream needs (D10; NOT the cycle's collection target, which
--     stays fund_editions.goal_cents).
--   • min_viable_cents — the minimum viable amount beside it. BALLOT INFORMATION, not the
--     shortfall gate: FUND-42's per-cycle floor + the winner's viability confirmation are
--     the gate (D11); this number is what lets a voter weigh a €3.000 dream the pool covers
--     against an €80.000 one it does not.
--   • skills_needed — bounded-vocabulary keys (D13). Like profiles.skills (#149) the DB
--     enforces shape (text[], ≤10); vocabulary membership against @athanor/core SKILLS is
--     the app boundary's job.
--   • category — CHECK against the existing project_category enum, used AS-IS (D43/D-24):
--     a coarse ballot filter, not a taxonomy of dreams.
--   • dream_id — nullable link to the member's own personal dream (D12, FUND-50); RLS lets
--     a member link only a dream they own.

-- ── 1. budget_cents + min_viable_cents (FUND-09, D10/D11) ───────────────────────────────
-- ADD COLUMN … NOT NULL cannot land on a non-empty table, so: add nullable → backfill the
-- known rows with explicit, chosen values → SET NOT NULL. No default stays on the columns —
-- the author declares the budget; the backfill below chooses values for staging's seeded
-- fake-world rows (production carries no candidacy rows).
alter table public.dream_candidacies
  add column budget_cents bigint,
  add column min_viable_cents bigint;

-- Staging's three seeded candidacies (seed-staging.sql §12), valued to read plausibly on a
-- ballot; the same values land in the seed INSERT so a fresh world matches.
update public.dream_candidacies set budget_cents = 800000,  min_viable_cents = 500000
 where id = md5('candidacy:marta_ceramica')::uuid and budget_cents is null;
update public.dream_candidacies set budget_cents = 1200000, min_viable_cents = 600000
 where id = md5('candidacy:ele_yoga')::uuid and budget_cents is null;
update public.dream_candidacies set budget_cents = 1500000, min_viable_cents = 900000
 where id = md5('candidacy:rocco_film')::uuid and budget_cents is null;
-- Staging's world is writable (candidacy_window_open = true, seed §12): testers may have
-- submitted real candidacies through the wizard, which could not declare a budget before
-- this column existed. Placeholder them explicitly rather than fail SET NOT NULL.
update public.dream_candidacies
   set budget_cents = 100000, min_viable_cents = 100000
 where budget_cents is null;

alter table public.dream_candidacies
  alter column budget_cents set not null,
  alter column min_viable_cents set not null,
  add constraint dream_candidacies_budget_cents_check check (budget_cents > 0),
  add constraint dream_candidacies_min_viable_cents_check check (
    min_viable_cents > 0 and min_viable_cents <= budget_cents
  );

comment on column public.dream_candidacies.budget_cents is
  'FUND-09/D10: the budget the dream needs, declared by the author. Not a collection target — that stays fund_editions.goal_cents.';
comment on column public.dream_candidacies.min_viable_cents is
  'FUND-09/D11: minimum viable amount beside the budget. Ballot information ONLY — the shortfall gate is FUND-42 (per-cycle floor + winner viability confirmation), never this.';

-- ── 2. skills_needed (FUND-10, D13) ─────────────────────────────────────────────────────
-- Mirrors profiles.skills (20260814104755): the DB bounds shape and cardinality; the keys
-- come from @athanor/core SKILLS (labels tag.skill.*) and membership is enforced at the app
-- boundary. Free-text here would kill the member-surfacing intersection the same way it
-- would have killed the matcher term.
alter table public.dream_candidacies
  add column skills_needed text[] not null default '{}'
    constraint dream_candidacies_skills_needed_bounds
    check (coalesce(array_length(skills_needed, 1), 0) <= 10);

comment on column public.dream_candidacies.skills_needed is
  'FUND-10/D13: curated keys from @athanor/core SKILLS the dream needs. Members carrying them are surfaced on the candidacy page; contact goes through existing chat. No engagement model, no contract record (D13).';

-- ── 3. category CHECK against project_category, as-is (FUND-11, D43/D-24) ───────────────
-- The column stays text + nullable (the wizard step is #226); the CHECK derives its value
-- set from the enum so the two can never drift. Staging's seed wrote pre-vocabulary values:
-- map them (§4's examples: crafts/film → artistic, care-home yoga → volunteer), then null
-- anything else invalid rather than fail the ALTER — a null category is a legal "not chosen
-- yet" state, an out-of-vocabulary one is not.
update public.dream_candidacies set category = 'artistic'  where category = 'craft';
update public.dream_candidacies set category = 'volunteer' where category = 'wellbeing';
update public.dream_candidacies set category = null
 where category is not null
   and category <> all (enum_range(null::public.project_category)::text[]);

alter table public.dream_candidacies
  add constraint dream_candidacies_category_check check (
    category is null or category = any (enum_range(null::public.project_category)::text[])
  );

comment on column public.dream_candidacies.category is
  'FUND-11/D43: one of the project_category enum values, used as-is — a coarse ballot filter, deliberately not a taxonomy of dreams. Written by the wizard (#226).';

-- ── 4. dream_id — the candidacy may link the member''s own dream (FUND-50, D12) ─────────
alter table public.dream_candidacies
  add column dream_id uuid references public.dreams (id) on delete set null;

comment on column public.dream_candidacies.dream_id is
  'FUND-50/D12: optional link to the author''s personal dream — real evidence of work (milestones, helps) on the ballot, and somewhere for progress reporting to hang. RLS: only a dream the author owns.';

create index dream_candidacies_dream_id on public.dream_candidacies (dream_id)
  where dream_id is not null;

-- Ownership is enforced in the write policies via athanor.owns_dream() (20260807174758) —
-- the DEFINER twin, so a link to the member's own dream keeps validating even if the dream
-- is later soft-deleted or visibility-gated. Policy names are unchanged (pgTAP policies_are
-- lists stay true); ALTER POLICY restates the full predicate.
alter policy "dream_candidacies_insert_own_verified"
  on public.dream_candidacies
  with check (
    (select auth.uid()) = profile_id
    and status = 'submitted'
    and public.is_identity_verified((select auth.uid()))
    and (dream_id is null or athanor.owns_dream(dream_id))
  );

alter policy "dream_candidacies_update_own_submitted"
  on public.dream_candidacies
  using ((select auth.uid()) = profile_id and status = 'submitted')
  with check (
    (select auth.uid()) = profile_id
    and status = 'submitted'
    and (dream_id is null or athanor.owns_dream(dream_id))
  );
