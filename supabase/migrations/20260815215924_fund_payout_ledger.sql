-- #247 — fund_payout_ledger: the transfer path's ledger, webhook-driven (ruling #244).
-- FUND-24 (jointly with #231's release gate) · FUND-SPEC §14 · design doc
-- docs/superpowers/specs/2026-08-08-p2p-dream-fund-design.md (separate charges and
-- transfers, funds resting in Athanor's balance; the transfer happens later on a
-- condition, so NO transfer_data at charge time).
--
-- What this table is: a CACHE of Stripe transfer webhooks (rule #6). The release path
-- (release-fund-payout, internal service-role — #248's sweep and the operator call it)
-- REQUESTS a transfer from Stripe and writes nothing; the stripe-webhook transfer.created
-- arm RECORDS it here, and transfer.reversed keeps it true. Stripe is the source of truth;
-- reconciliation is sum(amount_cents − reversed_cents) against the transfers Stripe lists
-- for the cycle's transfer_group.
--
-- The basis columns are the #232 rider made structural: a cycle's transfer amount derives
-- from THAT cycle's declared retention — fund_editions.split_pct, frozen at open — never a
-- constant, never a figure chosen at transfer time. Each row snapshots the basis it was
-- released under (pool_cents = the #220 confirmed_pool_cents snapshot, split_pct, and the
-- derived payable_cents), a CHECK pins the derivation, and the within-basis trigger below
-- (a) refuses a row whose basis diverges from the cycle's frozen declarations and
-- (b) refuses any insert that would push the cycle's released-net past its payable —
-- ruling #244's "no payout may exceed settled-minus-released at any moment", enforced in
-- the database rather than only in the executor. This is how #234's recorded costs and
-- #237's published figures come to describe the same money: both will read the same
-- declared-retention basis these rows carry.
--
-- destination_account_id is the Stripe acct_… string, NOT a FK to payout_accounts: the
-- payout_accounts row CASCADEs away with a profile erasure, and money history must
-- survive it (same reason fund_contributions keeps amounts after tombstoning). The owner
-- read below joins through payout_accounts instead, so a live winner reads their own
-- rows and an erased profile's rows simply stop being readable by anyone but admins.
-- No FK into profiles/auth.users, so the 0096 GDPR export sweep does not claim it —
-- deliberate: these rows are the platform's money record, not member content.
-- Not user content — no deleted_at. Zero Aura anywhere in this file (rule #1):
-- aura-boundary.test.ts adds it to MONEY_TABLES and pgTAP 0112 asserts it in-db.

create table public.fund_payout_ledger (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.fund_editions (id) on delete restrict,
  destination_account_id text not null,   -- acct_… — the transfer's destination, Stripe truth
  amount_cents bigint not null check (amount_cents > 0),
  -- transfer.reversed maintains this; partial reversals accumulate. Net released for a row
  -- is amount_cents − reversed_cents, so a full reversal self-excludes from every sum.
  reversed_cents bigint not null default 0 check (reversed_cents >= 0),
  currency text not null default 'eur' check (currency = lower(currency)),
  -- The declared-retention basis this row was released under (#232 rider):
  pool_cents bigint not null check (pool_cents >= 0),        -- confirmed_pool_cents at release
  split_pct integer not null check (split_pct between 0 and 100),
  payable_cents bigint not null,                             -- derived, never chosen (CHECK below)
  status text not null default 'released' check (status in ('released', 'reversed')),
  stripe_transfer_id text not null unique,                   -- tr_… — row-level idempotency
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fund_payout_ledger_reversal_within_amount
    check (reversed_cents <= amount_cents),
  -- payable = floor(pool × (100 − split) / 100): bigint division truncates, both operands
  -- non-negative, so this IS the floor. The figure cannot be typed in wrong.
  constraint fund_payout_ledger_payable_derived
    check (payable_cents = (pool_cents * (100 - split_pct)) / 100),
  constraint fund_payout_ledger_amount_within_payable
    check (amount_cents <= payable_cents),
  -- 'reversed' means fully reversed, exactly; partial reversals stay 'released'.
  constraint fund_payout_ledger_status_reversal_shape
    check ((status = 'reversed') = (reversed_cents = amount_cents))
);

comment on table public.fund_payout_ledger is
  '#247/#244: ledger of Stripe transfers to a cycle winner. Written ONLY by stripe-webhook transfer.created/transfer.reversed (service role); release-fund-payout requests, the webhook records (rule #6). Basis columns snapshot the cycle''s frozen declared retention (#232); the within-basis trigger caps released-net at payable. Owner + admin read. One destination per cycle (ruling #244). Zero Aura (rule #1). Money record, not member content — no deleted_at, survives profile erasure.';

comment on column public.fund_payout_ledger.payable_cents is
  '#232/#247: floor(pool_cents × (100 − split_pct) / 100) — the most a cycle''s winner can ever receive under the declared retention. CHECK-derived from the two basis columns; the remainder (pool − payable) is the declared retention #234 costs and #237 publishes against.';

create index fund_payout_ledger_edition
  on public.fund_payout_ledger (edition_id, created_at desc, id desc);  -- cycle reads: cursor, never offset

create trigger fund_payout_ledger_touch_updated_at
  before update on public.fund_payout_ledger
  for each row execute function public.touch_updated_at();

-- ── within-basis: the #244 cap and the #232 freeze, enforced where the rows land ────────
-- BEFORE INSERT (and any UPDATE that could raise the released-net): re-derive the basis
-- from the cycle's frozen columns, refuse divergence, and refuse a released-net sum past
-- payable. The SELECT … FOR UPDATE on the edition row serializes concurrent inserts for
-- the same cycle, so two webhook deliveries cannot both pass the sum check.
create function public.fund_payout_ledger_within_basis()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pool bigint;
  v_split integer;
  v_payable bigint;
  v_released_others bigint;
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
  return new;
end;
$$;

create trigger fund_payout_ledger_within_basis
  before insert or update of amount_cents, reversed_cents, edition_id, pool_cents, split_pct
  on public.fund_payout_ledger
  for each row execute function public.fund_payout_ledger_within_basis();

-- ── SRW posture (the payout_accounts / fund_contributions pattern) ──────────────────────
-- Hosted ALTER DEFAULT PRIVILEGES auto-grants client writes on new public tables, so a
-- blocked client write would silently affect 0 rows instead of raising 42501. Strip
-- everything, grant back exactly SELECT; the webhook writes as service_role.
revoke all on table public.fund_payout_ledger from anon, authenticated;
grant select on table public.fund_payout_ledger to authenticated;
grant all on table public.fund_payout_ledger to service_role;

alter table public.fund_payout_ledger enable row level security;

-- Owner: the winner whose connected account received the transfer, resolved through their
-- payout_accounts row (RLS-independent join — the policy runs as the table owner's scan,
-- the wrapped select keeps it one InitPlan evaluation per statement).
create policy "fund_payout_ledger_select_own"
  on public.fund_payout_ledger for select
  to authenticated
  using (exists (
    select 1 from public.payout_accounts pa
     where pa.stripe_account_id = destination_account_id
       and pa.profile_id = (select auth.uid())
  ));

-- Admin: the §20 report and the moderation panel read every row.
create policy "fund_payout_ledger_select_admin"
  on public.fund_payout_ledger for select
  to authenticated
  using ((select athanor.is_admin()));
-- NO insert/update/delete client policy. The webhook writes as service_role (bypasses RLS).

-- ── close_cycle: the ledger becomes the authoritative disbursed basis ───────────────────
-- 20260815193158 took an operator-supplied p_released_cents on 'realization_failed'
-- because "there is no tranche ledger yet". There is now, and the figure must not live in
-- two places (an operator retyping what the ledger already knows is the drift the #232
-- rider exists to prevent), so the parameter goes and the function reads the ledger:
-- disbursed on failure = the cycle's released-net, sum(amount_cents − reversed_cents) —
-- net of reversals, because a returned tranche nets against what remains unreleased
-- (ruling #244) and the returned money is part of what carries. 'realized' keeps D34's
-- frozen snapshot figure. What stays operator-supplied is WHEN and how much to release
-- (release-fund-payout's amount, until #228/#229's plan model schedules tranches) — never
-- what WAS released. The old signature is dropped (append-only applies to migration
-- files, not to function replacement); close-cycle/logic.ts drops releasedCents in step.
-- The prior migration's "tightening this parameter … is theirs (#228/#229)" comment is
-- corrected in supabase/MIGRATIONS-ERRATA.md; pgTAP 0110 asserts the new behaviour.
drop function public.close_cycle(uuid, text, text, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text);

create function public.close_cycle(
  p_edition_id uuid,
  p_outcome text,
  p_evidence text,
  p_target_at timestamptz,
  p_goal_cents bigint,
  p_min_funding_cents bigint,
  p_min_voters integer,
  p_min_candidacies integer,
  p_split_pct integer,
  p_cost_fee_statement text,
  p_equity_declared text
) returns table (successor_id uuid, closure_reason text, carried_in_cents bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_raised bigint;
  v_disbursed bigint;
  v_carry bigint;
  v_successor uuid;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent closures serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if p_outcome not in ('realized','realization_failed') then
    raise exception 'unknown outcome' using errcode = 'P0001';
  end if;
  -- Only an announced-or-realizing cycle can be declared over: nothing enters
  -- 'realization' until #228's plan transition, so 'announcement' with a confirmed winner
  -- is the working window for cycle 1 (the runbook order: confirm → deliver → close).
  if v_edition.phase not in ('announcement','realization') then
    raise exception 'closure out of phase' using errcode = 'P0001';
  end if;
  if v_edition.winner_candidacy_id is null then
    raise exception 'no winner declared' using errcode = 'P0001';
  end if;
  -- Realization never began without the winner's confirmation (#220): a cycle whose
  -- winner declined already closed voided_declined; one that never answered has nothing
  -- to realize or to fail.
  if v_edition.winner_confirmed_at is null then
    raise exception 'viability not confirmed' using errcode = 'P0001';
  end if;
  -- The admin act carries its evidence (D26 publication, against the published plan —
  -- recorded as text here; the plan linkage tightens when #228/#229 give plans a table).
  if p_evidence is null or btrim(p_evidence) = '' then
    raise exception 'evidence required' using errcode = 'P0001';
  end if;
  if p_outcome = 'realized' then
    -- Realized disburses the snapshot figure by definition (D34: «that frozen figure») —
    -- the winner's payable plus the declared retention, both accounted as having left the
    -- pool. A payable remainder still untransferred at closure stays releasable:
    -- release-fund-payout permits a 'closed'+'realized' cycle, capped by the same ledger.
    v_disbursed := v_edition.confirmed_pool_cents;
  else
    -- realization_failed (D33): disbursed = what actually reached the winner, read from
    -- the payout ledger (#247) — released-net, never an operator-typed figure. The
    -- unreleased remainder (declared retention included: failure is not charged) carries.
    select coalesce(sum(l.amount_cents - l.reversed_cents), 0) into v_disbursed
      from public.fund_payout_ledger l
     where l.edition_id = p_edition_id;
  end if;

  -- rule 6: money truth from source rows; fund_aggregates is the derived cache.
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  v_carry := greatest(v_edition.carried_in_cents + v_raised - v_disbursed, 0);

  -- Close first: fund_editions_one_active frees the non-closed slot before the successor
  -- claims it. Same statement writes the reason (fund_editions_closure_reason_shape).
  update public.fund_editions e
     set phase = 'closed', closure_reason = p_outcome
   where e.id = p_edition_id;

  if p_outcome = 'realization_failed' then
    -- The failed cycle ends without a delivered dream: the live field, winner included,
    -- goes terminal 'voided' — the record_winner_decision decline set. On 'realized' the
    -- statuses stand as the historical record (the winner delivered).
    update public.dream_candidacies c
       set status = 'voided'
     where c.edition_id = p_edition_id
       and c.status in ('submitted','screening','shortlisted','winner');
  end if;

  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'close_cycle', p_edition_id, v_edition.winner_candidacy_id,
          format('%s: %s — raised %s cents, carried_in %s, disbursed %s, carry %s',
                 p_outcome, btrim(p_evidence), v_raised, v_edition.carried_in_cents,
                 v_disbursed, v_carry));

  v_successor := public.fund_rollover_successor(
    p_edition_id, v_carry, p_target_at, p_goal_cents,
    p_min_funding_cents, p_min_voters, p_min_candidacies,
    p_split_pct, p_cost_fee_statement, p_equity_declared);

  return query select v_successor, p_outcome, v_carry;
end;
$$;

comment on function public.close_cycle(uuid, text, text, timestamptz, bigint, bigint, integer, integer, integer, text, text) is
  'FUND-45/D33/D35 (#221, disbursed basis rewired by #247): ends an open cycle (''realized'' — delivered against the published plan, disburses the frozen snapshot; or ''realization_failed'' — disbursed read from fund_payout_ledger released-net, never operator-typed) and opens the successor in the same transaction with carried_in = greatest(carried_in + raised − disbursed, 0). Contributors are refunded in no branch. Refuses (P0001, no write) out of phase, without a declared+confirmed winner, or without evidence. Service-role only. Zero Aura (rule #1).';

revoke execute on function public.close_cycle(uuid, text, text, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.close_cycle(uuid, text, text, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  to service_role;
