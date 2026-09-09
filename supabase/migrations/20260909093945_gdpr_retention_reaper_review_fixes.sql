-- #715 review findings. Two changes, one of them money.
--
-- ── 1. `rollover_voided` must add the carry too ────────────────────────────────────────────
--
-- 20260909085841 taught `recompute_fund_aggregate` to add `fund_editions.reaped_cents` back to
-- the live `sum(amount_cents)`, and its header claimed that was the whole job: "There is no
-- cached per-edition counter to keep in step — the total IS the rows." That sentence is wrong,
-- and the review caught it. Queried against staging rather than recalled, FIVE live functions
-- derive a per-edition total straight from `fund_contributions`:
--
--   recompute_fund_aggregate   the public ticker            — patched by 20260909085841
--   enter_announcement         the FUND-42 snapshot         — phase = 'voting' only
--   declare_winner             the FUND-42 floor            — phase in ('voting','announcement')
--   close_cycle                the closure carry            — phase in ('announcement','realization')
--   rollover_voided            the FUND-45 carry-forward    — phase = 'closed'  ← reachable
--
-- Only the first and the last can ever see a reaped edition, and for opposite reasons.
-- `recompute_fund_aggregate` is callable at any time by `gdpr_erase_fund_footprint`, which is
-- why it was patched. The three middle ones raise `P0001` unless the edition is in a live phase,
-- and an edition holding reaped rows is necessarily closed — a contribution is only reapable ten
-- years after its owner's erasure, and a cycle does not stay open for a decade.
--
-- `rollover_voided` is the exception that matters: it requires `phase = 'closed'`, which is
-- exactly the state a reaped edition is in. It computes
-- `v_carry := v_edition.carried_in_cents + v_raised` and hands that to the successor cycle, so a
-- voided edition rolled over after any of its contributions aged out would carry forward LESS
-- money than was raised — silently, and in the direction of paying a future winner short. Nothing
-- structurally prevents a late rollover; `already rolled over` is the only guard and it is about
-- double-carrying, not about elapsed time.
--
-- The fix is one term. `v_edition` is already `fund_editions%rowtype`, so `reaped_cents` is in
-- hand with no extra read, and it is qualified — an unqualified `reaped_cents` here would be
-- ambiguous against the OUT column list the way `carried_in_cents` already is. Body otherwise
-- preserved VERBATIM from the live definition (`pg_get_functiondef`, read off staging and
-- substituted programmatically rather than retyped), including the row lock, the four named
-- refusals and their order, SECURITY INVOKER and the empty search_path.
--
-- The three phase-guarded functions are deliberately NOT re-signed. Re-typing three money
-- functions to close a path that needs a decade-old open cycle would add more transcription risk
-- than it removes; `0150` §8 asserts their phase guards instead, so the reasoning above is a
-- tested property rather than a comment that rots.
create or replace function public.rollover_voided(
  p_edition_id uuid,
  p_target_at timestamptz,
  p_goal_cents bigint,
  p_min_funding_cents bigint,
  p_min_voters integer,
  p_min_candidacies integer,
  p_split_pct integer,
  p_cost_fee_statement text,
  p_equity_declared text)
returns table(successor_id uuid, carried_in_cents bigint)
language plpgsql
set search_path = ''
as $function$
declare
  v_edition public.fund_editions%rowtype;
  v_raised bigint;
  v_carry bigint;
  v_successor uuid;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent rollovers of the same predecessor serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_edition.phase <> 'closed' then
    raise exception 'cycle not closed' using errcode = 'P0001';
  end if;
  -- Only the three #220 voids arrive here without a successor; realized and failed
  -- closures create theirs inside close_cycle — rolling one of those over again would
  -- carry the same money twice.
  if v_edition.closure_reason not in ('voided_underfunded','voided_quorum','voided_declined') then
    raise exception 'predecessor not voided' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fund_editions s
              where s.carried_from_edition_id = p_edition_id) then
    raise exception 'already rolled over' using errcode = 'P0001';
  end if;
  -- Named refusal in front of the fund_editions_one_active 23505 belt.
  if exists (select 1 from public.fund_editions o where o.phase <> 'closed') then
    raise exception 'another cycle is open' using errcode = 'P0001';
  end if;

  -- The whole pool carries (FUND-SPEC §1): nothing was disbursed on a void.
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  -- #715: plus whatever the 10-year retention reaper has already deleted from this edition.
  -- Without this term a late rollover carries forward less than was raised.
  v_carry := v_edition.carried_in_cents + v_raised + v_edition.reaped_cents;

  v_successor := public.fund_rollover_successor(
    p_edition_id, v_carry, p_target_at, p_goal_cents,
    p_min_funding_cents, p_min_voters, p_min_candidacies,
    p_split_pct, p_cost_fee_statement, p_equity_declared);

  return query select v_successor, v_carry;
end;
$function$;

comment on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text) is
  'FUND-45 rollover of a voided cycle: carries carried_in_cents + the succeeded pool + fund_editions.reaped_cents (#715, so a reap cannot shorten a late carry) into a successor edition. Refuses unless the predecessor is closed, voided, unrolled, and no other cycle is open. Service-role only.';

revoke execute on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text) to service_role;

-- ── 2. the reaper refuses a row that still carries an identity ─────────────────────────────
--
-- The `fund_contributions` arm always checked `profile_id = gdpr_tombstone_profile_id()` as well
-- as the clock, so a row that somehow held a live identity could not be deleted however old its
-- stamp. The other two arms tested the clock alone, and that asymmetry sits on the worst failure
-- direction this function has: deleting a paying member's records.
--
-- The state is unreachable today — `erased_at` is written only by `gdpr_erase_payment_footprint`,
-- which nulls the identity in the same statement — so this is defence in depth, not a bug fix.
-- It is worth the two predicates anyway: the job runs unattended for a decade before it first
-- deletes anything, and "the stamp is set but the identity is still here" is precisely the
-- corruption nobody would be watching for. Both columns are indexed only via the partial
-- `erased_at` indexes, which still drive the scan; the null test is applied to the rows those
-- return.
--
-- Body otherwise unchanged from 20260909085841.
create or replace function public.gdpr_retention_reap()
returns table (reaped_table text, rows_deleted bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - public.gdpr_retention_window();
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
  v_tickets bigint;
  v_memberships bigint;
  v_contributions bigint;
begin
  -- fund_contributions: the carry and the delete are ONE statement, so there is no window in
  -- which the rows are gone and the cents are not yet recorded. A data-modifying CTE always
  -- runs to completion whether or not the outer query reads it.
  with reaped as (
    delete from public.fund_contributions
     where profile_id = v_tombstone
       and erased_at is not null
       and erased_at < v_cutoff
    returning edition_id, amount_cents, status
  ), carried as (
    update public.fund_editions e
       set reaped_cents = e.reaped_cents + agg.sum_cents
      from (
        select r.edition_id, sum(r.amount_cents) as sum_cents
          from reaped r
         where r.status = 'succeeded'
         group by r.edition_id
      ) agg
     where e.id = agg.edition_id
    returning 1
  )
  select count(*) into v_contributions from reaped;

  -- event_tickets: `event_attendance.ticket_id` cascades. Intended — see 20260909085841's header.
  -- `user_id is null` is the pseudonymisation check, the counterpart of the tombstone test above.
  delete from public.event_tickets
   where erased_at is not null
     and erased_at < v_cutoff
     and user_id is null;
  get diagnostics v_tickets = row_count;

  delete from public.circle_memberships
   where erased_at is not null
     and erased_at < v_cutoff
     and profile_id is null;
  get diagnostics v_memberships = row_count;

  return query
    select 'fund_contributions'::text, v_contributions
    union all select 'event_tickets'::text, v_tickets
    union all select 'circle_memberships'::text, v_memberships;
end;
$$;

comment on function public.gdpr_retention_reap() is
  'The 10-year retention reaper (#715): deletes pseudonymised rows from fund_contributions, event_tickets and circle_memberships once erased_at is older than gdpr_retention_window(). Deletes only rows whose identity is actually gone (tombstoned profile_id, or NULL user_id/profile_id), and never a row with a NULL erased_at however old. Carries the deleted cents to fund_editions.reaped_cents so raised_cents keeps every cent. Run nightly by the gdpr-retention-reap cron job. Service-role only.';

revoke execute on function public.gdpr_retention_reap() from public, anon, authenticated;
grant execute on function public.gdpr_retention_reap() to service_role;
