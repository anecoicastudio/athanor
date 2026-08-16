-- #229 — the winner authors the realization plan, then publishes it.
-- FUND-25 (the plan's nine items), FUND-53 (money spent according to the plan) ·
-- docs/FUND-SPEC.md §"Realization" · D25 («authored after selection, and re-costed to the
-- actual pool») · #228's migration (20260816073905) left this seam open by name.
--
-- WHO WRITES A PLAN. #228 shipped both tables service-write-only and said the decision was
-- this issue's. It is settled here as: DRAFTING IS MEMBER CONTENT, PUBLICATION IS A
-- TRANSITION. The winner types objective, phases, dates, amounts and criteria over days;
-- routing every save through a privileged relay would make an edge function the author's
-- text editor. The candidacy precedent (dream_candidacies_update_own_submitted) is the
-- right one: RLS pins ownership and the draft state, and the money invariant is not
-- delegated to the writer at all — #228's realization_plan_phases_within_payable trigger
-- caps the phase sum at the cycle's declared payable no matter who writes the row.
--
-- The #220 relay (record_winner_decision, service-role only) is NOT the precedent, and the
-- difference is worth stating: confirming viability is one irreversible legal answer taken
-- from the winner during an operator-run runbook (D41), while a draft is prose in progress.
-- Publication is where the two meet — it is a transition, so it is a function with a
-- refusal ladder rather than a column the client may set.
--
-- WHAT PUBLICATION DOES. It sets published_at (the plan becomes world-readable, #237/#230)
-- AND moves the cycle from 'announcement' to 'realization'. The second half closes a seam
-- both closure migrations named in prose — «nothing enters 'realization' until #228's plan
-- transition» (20260815193158:203, 20260815215924:204). The published plan IS what
-- realization is against, so it is the honest thing to gate that phase on: after it,
-- release-fund-payout's phase allowlist (logic.ts:141) admits the cycle, and #231's
-- verification gate has a frozen commitment to read.
--
-- AFTER PUBLICATION THE CLIENT CANNOT WRITE. Every policy below carries `published_at is
-- null`; there is no correction path here on purpose. Correcting a published commitment is
-- #230/#231's to define — a plan the winner may rewrite while tranches release against it
-- is not a commitment, and the ledger's plan_phase_id (ON DELETE SET NULL) means a
-- delete-and-recreate would silently drop a funded release's attribution.
--
-- COLUMN-LEVEL GRANTS, NOT ONLY POLICIES. RLS cannot say "these columns". Two columns must
-- stay unreachable from a client no matter what a policy allows: published_at (publication
-- is the function's, not an UPDATE) and realization_plan_phases.verified_at (#231's gate is
-- service-side — «no self-served verification»). Granting the authoring columns by name is
-- what keeps 0114's «client cannot mark their own phase verified» assertion true while the
-- same row becomes editable.
--
-- Zero Aura anywhere in this file (rule #1): authoring or publishing a plan grants nothing,
-- exactly as contributing money does not.

-- ── 1. audit_log: publication is a fund transition and is journaled like one ─────────────
-- Every other fund-state change writes a row (declare_winner, announce, void_cycle,
-- winner_confirm/decline, close_cycle, rollover_cycle). 'publish_plan' is the first fund
-- action with a REAL actor_id: the others are operator-relayed and pass null, while this
-- one is taken by the member, and recording who published the commitment is the point.
-- Drop → re-add both constraints, the 20260815183252 / 20260815193158 pattern.
alter table public.audit_log
  drop constraint audit_log_action_check,
  drop constraint audit_log_fund_shape;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen',
               'announce','void_cycle','winner_confirm','winner_decline',
               'close_cycle','rollover_cycle','publish_plan')
  ),
  add constraint audit_log_fund_shape check (
    action not in ('declare_winner','screen_start','screen_pass','screen_reject','screen_reopen',
                   'announce','void_cycle','winner_confirm','winner_decline',
                   'close_cycle','rollover_cycle','publish_plan')
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

-- ── 2. Grants: exactly the authoring columns, by name ────────────────────────────────────
-- #228 revoked everything and granted back SELECT. These add the write half, column by
-- column. `id` is deliberately absent from both INSERT lists: nothing here needs a
-- client-chosen key (the candidacy's client-generated id exists so a video can be uploaded
-- before the row does; a plan has no such ordering problem).
grant insert (edition_id, candidacy_id, objective, expected_result, professionals, suppliers)
  on table public.realization_plans to authenticated;
grant update (objective, expected_result, professionals, suppliers)
  on table public.realization_plans to authenticated;
-- NO delete grant on plans: one plan per cycle, and withdrawing one is not a member gesture
-- (#228's header). A draft is corrected by editing it.

grant insert (plan_id, sort, title, scheduled_for, amount_cents, verification_criteria)
  on table public.realization_plan_phases to authenticated;
grant update (sort, title, scheduled_for, amount_cents, verification_criteria)
  on table public.realization_plan_phases to authenticated;
grant delete on table public.realization_plan_phases to authenticated;

-- ── 3. Policies: the winning author, while the plan is a draft ───────────────────────────
-- The predicate is the same sentence everywhere — "the caller owns the candidacy this plan
-- binds, and the plan is unpublished" — because it IS the same rule. #228's binds_winner
-- trigger already refuses a plan whose candidacy did not win or whose winner never
-- confirmed viability (#220), so these policies do not restate it: ownership of the
-- candidacy plus that trigger is exactly "the confirmed winner, and only them".
create policy "realization_plans_insert_own_draft"
  on public.realization_plans for insert
  to authenticated
  with check (
    published_at is null
    and exists (
      select 1 from public.dream_candidacies c
       where c.id = candidacy_id
         and c.profile_id = (select auth.uid())
    )
  );

-- USING and WITH CHECK both (rule 2): USING alone would let the author update a draft OUT
-- of the draft state. Neither can actually be crossed here — published_at is not a granted
-- column — but a policy that relies on a grant for its own predicate is one grant widening
-- away from being wrong.
create policy "realization_plans_update_own_draft"
  on public.realization_plans for update
  to authenticated
  using (
    published_at is null
    and exists (
      select 1 from public.dream_candidacies c
       where c.id = candidacy_id
         and c.profile_id = (select auth.uid())
    )
  )
  with check (
    published_at is null
    and exists (
      select 1 from public.dream_candidacies c
       where c.id = candidacy_id
         and c.profile_id = (select auth.uid())
    )
  );

create policy "realization_plan_phases_insert_own_draft"
  on public.realization_plan_phases for insert
  to authenticated
  with check (exists (
    select 1 from public.realization_plans p
      join public.dream_candidacies c on c.id = p.candidacy_id
     where p.id = plan_id
       and p.published_at is null
       and c.profile_id = (select auth.uid())
  ));

create policy "realization_plan_phases_update_own_draft"
  on public.realization_plan_phases for update
  to authenticated
  using (exists (
    select 1 from public.realization_plans p
      join public.dream_candidacies c on c.id = p.candidacy_id
     where p.id = plan_id
       and p.published_at is null
       and c.profile_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.realization_plans p
      join public.dream_candidacies c on c.id = p.candidacy_id
     where p.id = plan_id
       and p.published_at is null
       and c.profile_id = (select auth.uid())
  ));

-- Delete is UNPUBLISHED-ONLY, and the restriction lives here rather than in the screen:
-- fund_payout_ledger.plan_phase_id is ON DELETE SET NULL, so deleting a phase that has
-- funded a tranche silently clears the attribution instead of refusing. Nothing funds a
-- phase before publication, so "draft only" is the same boundary stated where it holds.
create policy "realization_plan_phases_delete_own_draft"
  on public.realization_plan_phases for delete
  to authenticated
  using (exists (
    select 1 from public.realization_plans p
      join public.dream_candidacies c on c.id = p.candidacy_id
     where p.id = plan_id
       and p.published_at is null
       and c.profile_id = (select auth.uid())
  ));

-- ── 4. publish_realization_plan(): the transition, with its refusals ─────────────────────
-- SECURITY DEFINER, granted to authenticated — the resolve_report posture (20260622142310),
-- and genuinely required rather than convenient: the two writes are published_at (not a
-- granted column, by design) and fund_editions.phase (a table RLS denies every client
-- write on). The identity gate is inside the function, first, and the search_path is
-- locked; it takes only a plan id, so there is no body-supplied profile to trust (rule 8's
-- «profile_id is always derived» in RPC form).
--
-- Refusal order follows declare_winner's: identity, then existence, then authorship, then
-- state, then coherence — cheapest and most specific first, and every one raises before any
-- write, so a refused publication leaves nothing behind.
create function public.publish_realization_plan(p_plan_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.realization_plans%rowtype;
  v_edition public.fund_editions%rowtype;
  v_author uuid;
  v_phases integer;
  v_costed bigint;
  v_payable bigint;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select * into v_plan from public.realization_plans p
   where p.id = p_plan_id
   for update;   -- row lock: two concurrent publications serialize here
  if not found then
    raise exception 'plan not found' using errcode = 'P0001';
  end if;

  -- DEFINER bypasses the select policies, so authorship is re-derived rather than assumed
  -- from the fact that the caller could read the row.
  select c.profile_id into v_author from public.dream_candidacies c
   where c.id = v_plan.candidacy_id;
  if v_author is distinct from v_uid then
    raise exception 'not the plan author' using errcode = '42501';
  end if;

  if v_plan.published_at is not null then
    raise exception 'plan already published' using errcode = 'P0001';
  end if;

  select * into v_edition from public.fund_editions e
   where e.id = v_plan.edition_id
   for update;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  -- Only from 'announcement': the phase this transition leaves. A cycle already in
  -- 'realization' has a published plan (one plan per cycle), and a closed one takes no
  -- further transitions.
  if v_edition.phase <> 'announcement' then
    raise exception 'publication out of phase' using errcode = 'P0001';
  end if;
  -- Belt under the binds_winner trigger: that trigger checked confirmation when the plan
  -- was inserted, and a cycle cannot un-confirm (fund_editions_freeze_announcement), but
  -- publication is the moment money becomes releasable and it states its own precondition.
  if v_edition.winner_confirmed_at is null then
    raise exception 'viability not confirmed' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(f.amount_cents), 0) into v_phases, v_costed
    from public.realization_plan_phases f
   where f.plan_id = p_plan_id;
  -- A plan with no phases promises a result with no tranches — nothing for #231 to verify
  -- and nothing for the sweep to release.
  if v_phases = 0 then
    raise exception 'plan has no phases' using errcode = 'P0001';
  end if;
  -- The ceiling, re-read at the moment of commitment and in the same words the phase
  -- trigger raises. Phases are capped on write, so this can only fire if the cycle's
  -- declared economics moved under a finished draft — which the freeze triggers forbid.
  -- It is asserted anyway: publication is the last point where refusing is still cheap.
  v_payable := (v_edition.confirmed_pool_cents * (100 - v_edition.split_pct)) / 100;
  if v_costed > v_payable then
    raise exception 'phases exceed declared payable' using errcode = 'P0001';
  end if;

  update public.realization_plans p
     set published_at = v_now
   where p.id = p_plan_id;
  -- The cycle enters realization with its plan, not before it.
  update public.fund_editions e
     set phase = 'realization'
   where e.id = v_plan.edition_id;
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (v_uid, 'publish_plan', v_plan.edition_id, v_plan.candidacy_id,
          format('%s phases costed at %s cents against %s payable',
                 v_phases, v_costed, v_payable));
  return v_now;
end;
$$;

comment on function public.publish_realization_plan(uuid) is
  'FUND-25/FUND-53 (#229): the winner publishes their realization plan — sets realization_plans.published_at (world-readable from that moment, #237/#230) and moves the cycle from ''announcement'' to ''realization'', in one transaction with its audit_log row. Refuses (P0001/42501, no write) without auth, for a plan the caller did not author, on a published plan, out of phase, without the #220 viability confirmation, with no phases, or past the cycle''s declared payable. Callable by the author (SECURITY DEFINER: published_at and fund_editions are both closed to clients). Zero Aura (rule #1).';

revoke execute on function public.publish_realization_plan(uuid) from public, anon;
grant execute on function public.publish_realization_plan(uuid) to authenticated, service_role;

-- ── 5. The table comment #228 wrote against the deferred decision ────────────────────────
-- «written only by the service role (#229)» was true of that migration and is no longer
-- true of the table. A comment on a DB OBJECT is replaceable (unlike the prose inside an
-- applied migration file, which MIGRATIONS-ERRATA.md exists for), so it is replaced here.
comment on table public.realization_plans is
  '#228/#229/FUND-25: the winner''s realization plan for one cycle — prose (objective, professionals, suppliers, expected result) plus phases as rows. «Budget disponibile» is NOT stored here: it is fund_editions.confirmed_pool_cents, read live. One plan per cycle (unique edition_id); bound to that cycle''s winning candidacy by trigger. The author drafts it under RLS (insert/update, unpublished only, authoring columns granted by name); publish_realization_plan() sets published_at and moves the cycle into realization, after which no client write is possible. Public-read once published, author + admin read a draft. Member-authored prose — CASCADEs with the candidacy on GDPR erasure, so no deleted_at. Zero Aura (rule #1).';

comment on table public.realization_plan_phases is
  '#228/#229/FUND-25/FUND-53: one row per plan phase — date, amount, verification criteria: exactly what a tranche release reads. The phase-coherence trigger caps the plan''s phase sum at the cycle''s declared payable, so a plan can never promise more than the money that exists. The author inserts/edits/deletes phases while the plan is a draft; verified_at is #231''s gate slot and is granted to nobody, so a client can never verify their own phase. Public-read once the plan is published. Zero Aura (rule #1).';
