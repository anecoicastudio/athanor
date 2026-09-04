-- #402 — verify_plan_phase's evidence is trimmed of Unicode blanks, once.
--
-- 20260816110227:126-131 used bare btrim(), which strips U+0020 AND NOTHING ELSE. The gap
-- is one character wider than #402's title says: a tab-only or newline-only evidence string
-- reached the gate too, not just the exotic spaces. :150 then stored btrim(p_evidence) into
-- audit_log.reason under the same bare trim, so padding that got past the check was
-- journalled intact — validation and storage must share one trim or the row disagrees with
-- the rule that admitted it.
--
-- Unreachable today: the sole caller (verify-plan-phase/logic.ts:61) validates with Zod's
-- .trim().min(1), and JS String.trim() does strip U+00A0 and U+2028. Defense in depth for
-- the day the service role is driven by something else — a psql session, a future sweep.
--
-- THE CHARACTER SET, ruled 2026-08-17 on #402 (full measurements in that comment).
--
--   Not the display_name precedent (20260811080937:43, btrim(x, E' \t\n\r')). That set is
--   ASCII space/tab/LF/CR; measured on staging it leaves U+00A0 and U+2028 standing, which
--   is exactly the string #402 asks pgTAP to refuse. Consistency with it was not available.
--
--   Not [[:space:]] or \s either, though both DO classify NBSP, U+2028 and U+3000 on
--   PostgreSQL 17.6 under en_US.UTF-8 (measured on staging). That classification is
--   ctype-dependent, and this rule is asserted by pgTAP inside CI's own container while it
--   executes on the hosted projects. A guard whose truth depends on the locale of whatever
--   machine it happens to run on is not a guard.
--
--   So: an explicit character list. btrim(text, characters) is pure set membership — no
--   locale, no regex engine, identical everywhere. Thirty code points: the 25 Unicode
--   White_Space characters, plus five zero-width format characters (U+200B ZWSP, U+200C
--   ZWNJ, U+200D ZWJ, U+2060 WJ, U+FEFF BOM). The five go beyond #402 deliberately: the
--   gate's question is «is there evidence?», and a string made only of invisible characters
--   answers no — without them a ZWSP-only evidence string still passes. Trimming is
--   edge-only, so a meaningful mid-word joiner survives (verified: a<U+200C>b is returned
--   intact, as is accented Latin prose).
--
--   Written as chr(x'….'::int) rather than as literals or \u escapes. A literal NBSP in a
--   migration is invisible to review, and an escape sequence survives neither every editor
--   nor every tool that touches this file — this one was mangled into literal invisible
--   bytes twice while the migration was being written.
--
-- The trimmed value is computed ONCE into a local and used by all three sites: the empty
-- check, the length bound, and the audit row. Nothing else changes — the refusal ladder
-- keeps its order (evidence is judged last, after existence and state), and the exception
-- strings stay byte-identical because verify-plan-phase/logic.ts:37-61 maps them to client
-- codes and 0117 pins them by text. A reword would be a silent 502.
create or replace function public.verify_plan_phase(p_phase_id uuid, p_evidence text)
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
  -- Unicode White_Space (25) + the zero-width format characters (5). See the header.
  v_blank constant text :=
       chr(x'0009'::int) || chr(x'000A'::int) || chr(x'000B'::int) || chr(x'000C'::int)
    || chr(x'000D'::int) || chr(x'0020'::int) || chr(x'0085'::int) || chr(x'00A0'::int)
    || chr(x'1680'::int)
    || chr(x'2000'::int) || chr(x'2001'::int) || chr(x'2002'::int) || chr(x'2003'::int)
    || chr(x'2004'::int) || chr(x'2005'::int) || chr(x'2006'::int) || chr(x'2007'::int)
    || chr(x'2008'::int) || chr(x'2009'::int) || chr(x'200A'::int)
    || chr(x'2028'::int) || chr(x'2029'::int) || chr(x'202F'::int) || chr(x'205F'::int)
    || chr(x'3000'::int)
    || chr(x'200B'::int) || chr(x'200C'::int) || chr(x'200D'::int) || chr(x'2060'::int)
    || chr(x'FEFF'::int);
  v_evidence text;
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
  -- reason's 2000. The bound is measured on the TRIMMED value, which is also the value
  -- journalled — padding neither consumes the budget nor reaches the row (#402).
  v_evidence := btrim(coalesce(p_evidence, ''), v_blank);
  if v_evidence = '' then
    raise exception 'evidence required' using errcode = 'P0001';
  end if;
  if char_length(v_evidence) > 1000 then
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
                 v_phase.sort, v_phase.plan_id, v_phase.amount_cents, v_evidence));
  return v_now;
end;
$$;

-- CREATE OR REPLACE preserves both the comment and the ACL; both are restated so the
-- object's final state is readable in the file that last changed it.
comment on function public.verify_plan_phase(uuid, text) is
  'FUND-53 (#231): records that a realization plan phase met its verification criteria — the ex-ante gate release-fund-payout refuses a tranche without. Stamps realization_plan_phases.verified_at and writes the ''verify_phase'' audit row (which phase, what it unlocks, Athanor''s evidence — never the member-authored criteria, which the GDPR cascade must be able to remove), in one transaction. Refuses (P0001, no write) for an unknown phase, an unpublished plan, a cycle outside realization (or closed-realized), an already-verified phase, and missing or oversized evidence. Evidence is trimmed once against an explicit 30-character blank set (Unicode White_Space plus the zero-width format characters, #402) — that trimmed value is what is bounded at 1000 and what is journalled, so a string of invisible characters is refused and padding never reaches the audit row. service_role only — an Athanor admin act relayed by an operator (RELEASE-RUNBOOK §9.2c); the winner can never verify their own phase (verified_at is granted to no client). Zero Aura (rule #1).';

revoke execute on function public.verify_plan_phase(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_plan_phase(uuid, text) to service_role;
