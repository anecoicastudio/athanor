-- #231 — the tranche release gate: no verification, no money.
-- FUND-53 («il denaro raccolto dovrà essere utilizzato secondo il progetto approvato»,
-- «Il Fondo dei Sogni della Community» §10's strongest «dovrà»), FUND-24's fund half.
-- docs/FUND-SPEC.md:197 · divergence D-14/D-15 · ruling on #244.
--
-- THE GATE IS EX-ANTE. Verification is recorded BEFORE money moves, never reconciled
-- after. That is the whole content of §10's clause: an approved project is what the money
-- is spent according to, so a release that precedes its verification has already broken the
-- promise no matter what a later report says. The mechanism is therefore a precondition in
-- release-fund-payout's refusal ladder (the slot reserved at logic.ts:16-18), reading the
-- column this transition writes — not a reconciliation job.
--
-- WHAT THIS MIGRATION IS NOT. Not a new table, and not a second ledger. #228 shipped
-- realization_plan_phases.verified_at (20260816073905:113-125) and the ledger linkage
-- fund_payout_ledger.plan_phase_id with its FK and its two coherence checks
-- (20260816073905:313-395) precisely so this issue adds a transition and one Stripe
-- metadata key rather than a schema. Every column this gate needs already exists.
--
-- WHO VERIFIES — an Athanor admin act with evidence, never the winner. FUND-SPEC:197 says
-- «each on verification» without naming an actor, and D26 governs the CYCLE's final
-- realization declaration (§12), not §10's per-phase verification — so neither states it
-- outright. The shipped tree does: realization_plan_phases' authenticated write grants list
-- sort/title/scheduled_for/amount_cents/verification_criteria and deliberately NOT
-- verified_at (20260816082552:80-83, whose header calls it «no self-served verification»),
-- and pgTAP 0115:47-48,142-144 already asserts a client cannot write it. A dreamer who
-- could verify their own phase would hold the gate on their own money, which is the one
-- shape FUND-53 exists to forbid. So: service-role only, relayed by an operator, per
-- docs/RELEASE-RUNBOOK.md §9 — the per-phase sibling of #221's «Athanor declares realized
-- against the published plan, an admin act with evidence, never a second community vote».
--
-- Zero Aura (rule #1): verifying a phase grants nothing, exactly as releasing the tranche
-- it gates grants nothing and as contributing money grants nothing.

-- ── 1. audit_log: verification is a fund transition and is journaled like one ────────────
-- Drop → re-add both constraints, the 20260815183252 / 20260815193158 / 20260816082552
-- pattern (Postgres has no ADD CONSTRAINT IF NOT EXISTS and no in-place CHECK edit).
-- actor_id is null like every operator-relayed fund action — 'publish_plan' remains the
-- only one with a real actor, because it is the only one the member takes themselves.
alter table public.audit_log
  drop constraint audit_log_action_check,
  drop constraint audit_log_fund_shape;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen',
               'announce','void_cycle','winner_confirm','winner_decline',
               'close_cycle','rollover_cycle','publish_plan','verify_phase')
  ),
  add constraint audit_log_fund_shape check (
    action not in ('declare_winner','screen_start','screen_pass','screen_reject','screen_reopen',
                   'announce','void_cycle','winner_confirm','winner_decline',
                   'close_cycle','rollover_cycle','publish_plan','verify_phase')
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

-- ── 2. verify_plan_phase(): the transition ──────────────────────────────────────────────
-- SECURITY INVOKER + service_role-only EXECUTE, the declare_winner posture
-- (20260815093035:68-153) rather than publish_realization_plan's DEFINER: that one is
-- DEFINER because a MEMBER calls it and must reach columns closed to clients. This one is
-- called by the service role, which already reaches everything, so DEFINER would buy
-- nothing and would only widen what a future mis-grant could reach (rules/supabase-db.md:
-- «SECURITY DEFINER only when genuinely required»).
--
-- The refusal order is declare_winner's — existence, then state, then coherence, cheapest
-- and most specific first — and every refusal raises P0001 BEFORE any write, so a refused
-- verification leaves nothing behind. Both writes plus the audit row are one transaction:
-- there is no state in which a phase is verified without its journal entry, which is what
-- makes the audit trail evidence rather than commentary.
create function public.verify_plan_phase(p_phase_id uuid, p_evidence text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_phase public.realization_plan_phases%rowtype;
  v_plan public.realization_plans%rowtype;
  v_edition public.fund_editions%rowtype;
  v_now timestamptz := now();
begin
  select * into v_phase from public.realization_plan_phases f
   where f.id = p_phase_id
   for update;   -- row lock: two concurrent verifications of one phase serialize here
  if not found then
    raise exception 'plan phase not found' using errcode = 'P0001';
  end if;

  select * into v_plan from public.realization_plans p
   where p.id = v_phase.plan_id;
  if not found then
    raise exception 'plan not found' using errcode = 'P0001';
  end if;
  -- A draft is not a commitment. Verifying a phase of an unpublished plan would let the
  -- criteria be rewritten AFTER the judgement that they were met — the plan is frozen at
  -- publication (20260816082552:29-33) precisely so «verified» names a fixed standard.
  if v_plan.published_at is null then
    raise exception 'plan not published' using errcode = 'P0001';
  end if;

  select * into v_edition from public.fund_editions e
   where e.id = v_plan.edition_id;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  -- Mirrors release-fund-payout's phase allowlist minus 'announcement', which a published
  -- plan has already left (publish_realization_plan moves the cycle into 'realization' in
  -- the same transaction). Verification must be legal wherever release is legal, or a
  -- tranche could become permanently unreleasable on a cycle that closed realized with a
  -- phase still unjudged.
  if not (v_edition.phase = 'realization'
          or (v_edition.phase = 'closed' and v_edition.closure_reason = 'realized')) then
    raise exception 'verification out of phase' using errcode = 'P0001';
  end if;

  -- One-way, like publication. Re-verifying would let a second judgement silently replace
  -- the first while the tranche it released stands, so the second attempt refuses instead.
  if v_phase.verified_at is not null then
    raise exception 'phase already verified' using errcode = 'P0001';
  end if;

  -- The admin act carries its evidence (close_cycle's 'evidence required', 20260815193158:
  -- 217-221). Bounded here rather than left to audit_log.reason's own CHECK: the reason is
  -- COMPOSED below, so an unbounded argument would surface as a bare 23514 from a
  -- constraint the caller never named. 1000 leaves room for the composed prefix inside
  -- reason's 2000.
  if p_evidence is null or btrim(p_evidence) = '' then
    raise exception 'evidence required' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_evidence)) > 1000 then
    raise exception 'evidence too long' using errcode = 'P0001';
  end if;

  update public.realization_plan_phases f
     set verified_at = v_now
   where f.id = p_phase_id;
  -- THE PHASE'S OWN PROSE IS DELIBERATELY NOT COPIED HERE. Journaling title and
  -- verification_criteria would read as the fuller record, and it is the wrong one twice
  -- over: (a) they are member-authored text, and the plan CASCADEs on a GDPR erasure
  -- (20260816073905:300-306) exactly so that prose goes — audit_log does not cascade, so a
  -- copy here would outlive the erasure that was supposed to remove it; (b) criteria alone
  -- reaches 2000 chars, which is reason's whole CHECK budget, so a composed row could raise
  -- a bare 23514 from a constraint the caller never named. What is journaled is the
  -- identifying facts (which phase, how much it unlocks) plus Athanor's own evidence.
  -- After an erasure this row honestly records that a phase was verified and what for,
  -- while the phase it named is gone — the same shape as fund_payout_ledger.plan_phase_id
  -- going null under the same cascade.
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'verify_phase', v_plan.edition_id, v_plan.candidacy_id,
          format('phase %s of %s, unlocking %s cents: %s',
                 v_phase.sort, v_phase.plan_id, v_phase.amount_cents, btrim(p_evidence)));
  return v_now;
end;
$$;

comment on function public.verify_plan_phase(uuid, text) is
  'FUND-53 (#231): records that a realization plan phase met its verification criteria — the ex-ante gate release-fund-payout refuses a tranche without. Stamps realization_plan_phases.verified_at and writes the ''verify_phase'' audit row (which phase, what it unlocks, Athanor''s evidence — never the member-authored criteria, which the GDPR cascade must be able to remove), in one transaction. Refuses (P0001, no write) for an unknown phase, an unpublished plan, a cycle outside realization (or closed-realized), an already-verified phase, and missing or oversized evidence. service_role only — an Athanor admin act relayed by an operator (RELEASE-RUNBOOK §9.2c); the winner can never verify their own phase (verified_at is granted to no client). Zero Aura (rule #1).';

revoke execute on function public.verify_plan_phase(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_plan_phase(uuid, text) to service_role;

-- ── 3. The comments #228/#248 wrote against this deferral ────────────────────────────────
-- A comment on a DB OBJECT is replaceable (the 20260816082552 §5 precedent); the prose
-- inside an applied migration FILE is not, which is what supabase/MIGRATIONS-ERRATA.md
-- exists for. Both of these said «nothing writes it» / «inert by construction», which this
-- migration is the event that falsifies.
comment on column public.realization_plan_phases.verified_at is
  '#231/FUND-53: when an Athanor admin recorded that this phase met its verification_criteria — written ONLY by verify_plan_phase() (service_role), never by any client. release-fund-payout refuses a tranche targeting a phase where this is null: no verification, no money.';

comment on function public.invoke_fund_settle_sweep() is
  'Daily: asks release-fund-payout''s sweep mode to release any due payout tranches (#248). Live since #231 — the sweep enumerates published plans'' verified, not-yet-fully-released phases; the edge function''s refusal ladder decides whether money moves, never this wrapper.';
