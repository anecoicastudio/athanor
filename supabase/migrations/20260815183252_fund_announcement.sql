-- #220 — announcement: snapshot the pool, take the winner's viability confirmation, or void.
-- FUND-42, FUND-44 · decisions D33, D34, D41 (docs/FUND-DECISIONS.md) · FUND-SPEC §1, §3
-- ("The cycle boundary", "Winner failure").
--
-- The two-part shortfall gate, on the columns #216 made representable:
--
--   • enter_announcement() — the one path out of 'voting'. Evaluates quorum (FUND-43) and
--     the funding floor (FUND-42) at the moment of entry: below either, the cycle is VOIDED
--     — phase 'closed', closure_reason published, candidacies terminal 'voided' — and no
--     snapshot is ever written. Above both, the pool is snapshotted into
--     confirmed_pool_cents and phase becomes 'announcement'. Contributions do not stop
--     (D34): the snapshot fixes the winner's figure without closing the gate — the D34
--     allowlist in create-contribution-session accepts 'announcement' and 'realization'
--     untouched by this migration.
--   • record_winner_decision() — the winner confirms the dream is deliverable at the
--     snapshotted figure, or declines. Declining voids the cycle (voided_declined, D33's
--     pre-tranche branch): the judgement sits with the person who knows what the dream
--     costs. No runner-up is promoted, ever (FUND-SPEC §4 non-goal).
--
-- Composition with declare_winner() (#219), not duplication: its phase window already
-- spans ('voting','announcement') and its quorum/floor refusals read live figures. Voters
-- are fixed once the ballot closes and the pool only grows, so a cycle that passed this
-- function's entry checks can never be refused by declare_winner's — the runbook order is
-- enter_announcement → declare_winner → record_winner_decision, and either order of the
-- first two stays legal. The floor here is evaluated against the snapshot value (D34:
-- «that frozen figure is what FUND-42's floor is evaluated against») — computed from
-- fund_contributions source rows, the sum fund_aggregates.raised_cents caches, because the
-- cache is webhook-recomputed and money truth comes from source rows (rule 6, the
-- declare_winner precedent).
--
-- Seam with #221 (closure and rollover): the void paths here bring the cycle to its named
-- end-state — closure_reason set, candidacies 'voided'. Creating the successor cycle and
-- moving the pool into its carried_in_cents is #221's transaction, deliberately not begun
-- here. D33's post-tranche-one failure vocabulary is likewise #221's call (the #216
-- migration header records this).
--
-- Zero Aura anywhere in this file (rule #1).

-- ── 1. winner_confirmed_at — the confirmation, recorded (FUND-42) ───────────────────────
-- A column, not only an audit row: audit_log is admin-read only, while phase gates (#221's
-- closure, #228's plan) must be able to ask "was viability confirmed?" with a row read.
-- NULL = not (yet) confirmed; a declined cycle closes with it still NULL.
alter table public.fund_editions
  add column winner_confirmed_at timestamptz,
  add constraint fund_editions_winner_confirmed_shape check (
    winner_confirmed_at is null
    or (winner_candidacy_id is not null and phase in ('announcement','realization','closed'))
  );

comment on column public.fund_editions.winner_confirmed_at is
  '#220/FUND-42: when the winner confirmed the dream is deliverable at confirmed_pool_cents. NULL until record_winner_decision(''confirm''); stays NULL on a decline (the cycle closes voided_declined instead). Requires a declared winner and never predates announcement (fund_editions_winner_confirmed_shape).';

-- ── 2. The snapshot presence #216 deferred ──────────────────────────────────────────────
-- #216: "when it becomes mandatory is #220's announcement-transition semantics — #220 adds
-- one if its transition guarantees it." It does: the only path into 'announcement' writes
-- the snapshot in the same statement, and a quorum/floor void closes the cycle without
-- ever entering 'announcement'. So: announcement and realization ALWAYS carry a snapshot;
-- 'closed' stays either way (voided before announcement → none; realized or declined →
-- the historical figure).
alter table public.fund_editions
  add constraint fund_editions_snapshot_presence check (
    phase not in ('announcement','realization') or confirmed_pool_cents is not null
  );

-- ── 3. Snapshot and confirmation are immutable once written ─────────────────────────────
-- Trigger, not a policy: RLS already denies every client write on fund_editions and the
-- remaining writer is the service role, which RLS cannot restrain (the
-- fund_editions_freeze_declarations precedent, 20260815155811). IS DISTINCT FROM keeps
-- idempotent same-value write-backs legal; NULL → value is the one legal direction.
create function public.fund_editions_announcement_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'announcement facts are frozen once written (#220): confirmed_pool_cents is the figure the winner confirmed viability at and winner_confirmed_at is when — neither can change'
    using errcode = 'P0001';
end;
$$;

create trigger fund_editions_freeze_announcement
  before update on public.fund_editions
  for each row
  when (
    (old.confirmed_pool_cents is not null
     and old.confirmed_pool_cents is distinct from new.confirmed_pool_cents)
    or (old.winner_confirmed_at is not null
        and old.winner_confirmed_at is distinct from new.winner_confirmed_at)
  )
  execute function public.fund_editions_announcement_frozen();

-- ── 4. audit_log: the announcement actions ──────────────────────────────────────────────
-- Same drop → re-add as 20260815093035 / 20260815164809. Four new fund-shaped actions:
-- 'announce' (snapshot written), 'void_cycle' (any void — the reason text names the cause;
-- #221's closure paths are expected to reuse it), 'winner_confirm', 'winner_decline'.
alter table public.audit_log
  drop constraint audit_log_action_check,
  drop constraint audit_log_fund_shape;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen',
               'announce','void_cycle','winner_confirm','winner_decline')
  ),
  add constraint audit_log_fund_shape check (
    action not in ('declare_winner','screen_start','screen_pass','screen_reject','screen_reopen',
                   'announce','void_cycle','winner_confirm','winner_decline')
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

-- ── 5. enter_announcement(): snapshot the pool, or void with the published reason ───────
-- INVOKER, service_role-only grant, refusals before any write — exactly declare_winner's
-- posture (rule 8: the only caller is the announce-cycle edge function). Refusal order:
-- identity → phase → ballot closed (NULL arm explicit — IF NULL is false, the 20260815094157
-- errata) — then the two-part shortfall gate in declare_winner's order: quorum (FUND-43)
-- first, floor (FUND-42) second, so a doubly-failed cycle publishes voided_quorum.
-- Candidacies of a voided cycle go terminal 'voided' regardless of deleted_at — a
-- soft-deleted 'submitted' row must not outlive its cycle as a live status. 'rejected'
-- stays rejected (already terminal); 'winner' cannot be present on the void branch: a
-- declared winner implies declare_winner's live quorum/floor checks passed, voters are
-- fixed after ballot close and the pool only grows, so this function's checks pass too.
create function public.enter_announcement(p_edition_id uuid)
returns table (outcome text, pool_cents bigint, voters integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_voters integer;
  v_raised bigint;
  v_reason text;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: a concurrent entry or declaration serializes here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  -- Only from 'voting'. This is also the snapshot's write-once guarantee at the function
  -- level: a cycle already in 'announcement' cannot re-enter and re-snapshot (the freeze
  -- trigger is the belt under it).
  if v_edition.phase <> 'voting' then
    raise exception 'announcement out of phase' using errcode = 'P0001';
  end if;
  -- An undeclared window cannot close; the NULL arm is explicit because IF NULL is false.
  if v_edition.voting_ends_at is null or now() <= v_edition.voting_ends_at then
    raise exception 'ballot not closed' using errcode = 'P0001';
  end if;

  select count(distinct v.voter_id) into v_voters
    from public.candidacy_votes v where v.edition_id = p_edition_id;
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';

  if v_voters < v_edition.min_voters then
    v_reason := 'voided_quorum';
  elsif v_raised < v_edition.min_funding_cents then
    v_reason := 'voided_underfunded';
  end if;

  if v_reason is not null then
    -- The void: named end-state, published reason, funds carry forward at #221's rollover.
    -- The counter does not reset (FUND-SPEC §1: only realization resets it).
    update public.fund_editions e
       set phase = 'closed', closure_reason = v_reason
     where e.id = p_edition_id;
    update public.dream_candidacies c
       set status = 'voided'
     where c.edition_id = p_edition_id
       and c.status in ('submitted','screening','shortlisted');
    insert into public.audit_log (actor_id, action, edition_id, reason)
    values (null, 'void_cycle', p_edition_id,
            format('%s: distinct voters %s (min %s), pool %s cents (min %s)',
                   v_reason, v_voters, v_edition.min_voters, v_raised, v_edition.min_funding_cents));
    return query select v_reason, v_raised, v_voters;
    return;
  end if;

  -- The snapshot: phase and figure in one statement, so fund_editions_snapshot_presence
  -- can never observe 'announcement' without it.
  update public.fund_editions e
     set phase = 'announcement', confirmed_pool_cents = v_raised
   where e.id = p_edition_id;
  insert into public.audit_log (actor_id, action, edition_id, reason)
  values (null, 'announce', p_edition_id,
          format('snapshot %s cents (floor %s), distinct voters %s (min %s)',
                 v_raised, v_edition.min_funding_cents, v_voters, v_edition.min_voters));
  return query select 'announced'::text, v_raised, v_voters;
end;
$$;

comment on function public.enter_announcement(uuid) is
  'FUND-42/FUND-44 (#220): the one path out of ''voting'' — snapshots the pool into confirmed_pool_cents and enters ''announcement'', or voids the cycle (voided_quorum / voided_underfunded: phase ''closed'', candidacies ''voided'', audit row) when the two-part shortfall gate fails. Refuses (P0001, no write) out of phase or before ballot close. Contributions keep flowing either way (D34). Service-role only. Zero Aura (rule #1).';

revoke execute on function public.enter_announcement(uuid) from public, anon, authenticated;
grant execute on function public.enter_announcement(uuid) to service_role;

-- ── 6. record_winner_decision(): deliverable at that figure, or a dignified exit ────────
-- The decision is the winner's (FUND-SPEC §1: «the winner confirms viability at the
-- snapshotted amount»); the caller is the operator relaying it, per D41's cycle-1 runbook
-- model — service-role edge function first, member-facing surface later. A later
-- user-callable surface layers on this same function without schema change.
create function public.record_winner_decision(p_edition_id uuid, p_decision text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent decisions serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if p_decision not in ('confirm','decline') then
    raise exception 'unknown decision' using errcode = 'P0001';
  end if;
  -- Only during 'announcement': after realization begins the exit is #221's failure path,
  -- and a closed cycle takes no further decisions.
  if v_edition.phase <> 'announcement' then
    raise exception 'decision out of phase' using errcode = 'P0001';
  end if;
  if v_edition.winner_candidacy_id is null then
    raise exception 'no winner declared' using errcode = 'P0001';
  end if;
  -- Covers both re-confirmation and a decline after confirming: the recorded confirmation
  -- is the point of no return on this path (withdrawing after it is #221's vocabulary).
  if v_edition.winner_confirmed_at is not null then
    raise exception 'viability already confirmed' using errcode = 'P0001';
  end if;

  if p_decision = 'confirm' then
    update public.fund_editions e
       set winner_confirmed_at = now()
     where e.id = p_edition_id;
    insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
    values (null, 'winner_confirm', p_edition_id, v_edition.winner_candidacy_id,
            format('deliverable at %s cents', v_edition.confirmed_pool_cents));
    return 'confirmed';
  end if;

  -- The decline: D33's pre-tranche branch, «a dignified exit instead of an impossible
  -- promise». The winner's candidacy goes terminal 'voided' with the rest of the live
  -- field; no runner-up is promoted (FUND-SPEC §4 non-goal).
  update public.fund_editions e
     set phase = 'closed', closure_reason = 'voided_declined'
   where e.id = p_edition_id;
  update public.dream_candidacies c
     set status = 'voided'
   where c.edition_id = p_edition_id
     and c.status in ('submitted','screening','shortlisted','winner');
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'winner_decline', p_edition_id, v_edition.winner_candidacy_id,
          format('declined as undeliverable at %s cents', v_edition.confirmed_pool_cents));
  return 'voided_declined';
end;
$$;

comment on function public.record_winner_decision(uuid, text) is
  'FUND-42/D33 (#220): records the winner''s viability decision at the confirmed_pool_cents figure — confirm stamps winner_confirmed_at; decline voids the cycle (voided_declined, candidacies ''voided'', no runner-up). Refuses (P0001, no write) out of phase, without a declared winner, or once confirmed. Operator-relayed per D41''s cycle-1 runbook. Service-role only. Zero Aura (rule #1).';

revoke execute on function public.record_winner_decision(uuid, text) from public, anon, authenticated;
grant execute on function public.record_winner_decision(uuid, text) to service_role;
