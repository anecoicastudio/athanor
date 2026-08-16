-- #229 — the two realization-plan triggers become SECURITY DEFINER.
--
-- Found by 0115 the first time a CLIENT wrote a plan, which is the first time either
-- trigger ran as anything but the service role:
--
--   42501: permission denied for table fund_editions
--     CONTEXT: select e.winner_candidacy_id, e.winner_confirmed_at from public.fund_editions e
--              where e.id = new.edition_id for update
--     PL/pgSQL function public.realization_plans_binds_winner() line 6
--
-- Both functions (20260816073905) read `public.fund_editions ... FOR UPDATE` to serialize
-- their check against concurrent writers. `SELECT ... FOR UPDATE` requires the UPDATE
-- privilege on the locked table, and no client has — nor should ever have — UPDATE on
-- fund_editions. As SECURITY INVOKER the guard therefore refuses the very writer #229 made
-- legitimate, and the refusal arrives as a bare permission error rather than as one of its
-- own named reasons.
--
-- DEFINER is the correct posture here, not a workaround, and it fixes a second latent bug
-- in the same move: an INVOKER guard evaluates its own predicates under the CALLER's RLS.
-- realization_plan_phases_within_payable sums the plan's OTHER phases to test the payable
-- ceiling — a caller who could not see a sibling row would compute a smaller sum and slip
-- past a ceiling that is the whole point of the trigger. A guard must see everything it
-- guards. (Not reachable today: the only client writer is the author, whose select_own
-- policy shows every phase of their own plan. It stops being a property of who happens to
-- write and becomes a property of the function.)
--
-- Bodies are otherwise VERBATIM from 20260816073905 — the only edits are the `security
-- definer` line and this rationale. search_path stays locked to '' (every reference is
-- already schema-qualified), so the definer privilege cannot be redirected by a caller's
-- search_path. CREATE OR REPLACE keeps the existing triggers pointing at them: append-only
-- applies to migration FILES, not to function definitions (the fund_payout_ledger_within_basis
-- precedent, 20260816073905 §6).
--
-- Zero Aura (rule #1): both functions only read and raise.

create or replace function public.realization_plans_binds_winner()
returns trigger
language plpgsql
security definer
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

comment on function public.realization_plans_binds_winner() is
  '#228/#229: BEFORE INSERT/UPDATE guard on realization_plans — refuses a plan whose candidacy did not win its cycle, or whose winner never confirmed viability (#220). SECURITY DEFINER since #229: it locks the fund_editions row (FOR UPDATE needs the UPDATE privilege, which no client has or should have) and must see the cycle regardless of the writer''s RLS. Reads and raises only.';

create or replace function public.realization_plan_phases_within_payable()
returns trigger
language plpgsql
security definer
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

comment on function public.realization_plan_phases_within_payable() is
  '#228/#229: BEFORE INSERT/UPDATE guard on realization_plan_phases — refuses a phase that would take the plan''s phase sum past the cycle''s declared payable, floor(confirmed_pool_cents × (100 − split_pct) / 100), the same ceiling fund_payout_ledger caps releases at (#244). SECURITY DEFINER since #229: it locks the fund_editions row, and a sum that is the invariant must count every sibling phase, not only those the writer''s RLS reveals. Reads and raises only.';

-- Trigger functions are invoked by the trigger, not called by a role, so EXECUTE is never
-- checked on them. Revoked anyway: a DEFINER function reachable by name is a privilege
-- surface, and «revoke execute from public/anon/authenticated» is the standing rule for one.
revoke execute on function public.realization_plans_binds_winner() from public, anon, authenticated;
revoke execute on function public.realization_plan_phases_within_payable() from public, anon, authenticated;
