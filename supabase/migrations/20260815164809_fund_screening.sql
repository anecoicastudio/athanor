-- #218 — screening: a service-role transition against published, objective criteria.
-- FUND-52 · decisions D4 (admission gate, ballot final), D5 (objective criteria only,
-- no Aura threshold), D6 (rejections carry a reason from the stated criteria, appealable)
-- (docs/FUND-DECISIONS.md). Five parts:
--   1. screening_criteria — the published criteria as data (D5's four), world-readable;
--   2. dream_candidacies.rejection_reasons — a rejection carries its reason, CHECK-paired
--      to the status so neither can exist without the other;
--   3. audit_log CHECKs grow the four screening actions (drop + re-create, the
--      20260815093035 pattern);
--   4. screen_candidacy() — the one transition path, service-role only, refusals before
--      any write;
--   5. is_on_ballot() narrows to the SCREENED set ('shortlisted','winner') — the
--      convergence 20260815090015's header promised. #383 gave the set one home; this is
--      the one edit. The partial index reading the predicate is rebuilt in the same
--      migration (IMMUTABLE contract stated on the function).
-- Zero Aura anywhere in this file (rule #1); pgTAP 0107 asserts it.

-- ── 1. The published criteria (D5) ──────────────────────────────────────────────────────
-- Data, not prose: the reject path validates its reasons against these rows, and the
-- FUND-38 surface (#237) renders them from i18n keys keyed by `code`
-- (fund.screening.criteria.<code>.t/.d). Not user content — no deleted_at.
create table public.screening_criteria (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  sort smallint not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger screening_criteria_touch_updated_at
  before update on public.screening_criteria
  for each row execute function public.touch_updated_at();

comment on table public.screening_criteria is
  '#218/D5: the published screening criteria — objective only, each one a thing a rejected candidate can be told and can fix. No Aura criterion, by decision (D5). World-readable (FUND-52 says published); written only by migrations/service role. rejection_reasons validates against code.';

revoke all on table public.screening_criteria from anon, authenticated;
grant select on table public.screening_criteria to anon, authenticated;
grant all on table public.screening_criteria to service_role;

alter table public.screening_criteria enable row level security;

-- Published means published: the #237 page renders these signed-out (anon).
create policy "screening_criteria_select_all"
  on public.screening_criteria for select
  to anon, authenticated
  using (true);
-- No write policies: deny-by-default RLS; only migrations and the service role write.

insert into public.screening_criteria (code, sort) values
  ('identity_verified',      1),  -- D5: identity verified (insert-gated already; re-checked at pass)
  ('proposal_complete',      2),  -- D5: proposal complete, budget + minimum viable included
  ('no_moderation_sanction', 3),  -- D5: not under an active moderation sanction
  ('plan_coherent',          4);  -- D5: plan coherent enough to verify a tranche release against

-- ── 2. A rejection carries its reason (D6) ──────────────────────────────────────────────
-- On the candidacy row, not only in audit_log: audit is admin-read only, while the
-- rejected author must be able to read what to fix (own-row select policy shows any
-- status). Element validity is the function's job (an array has no FK); the CHECK pins
-- presence: rejected ⇔ reasons, in both directions. No backfill needed — nothing has
-- ever written status='rejected' (clients are pinned to 'submitted', declare_winner
-- writes only 'winner'), so the two-sided CHECK lands on zero rejected rows.
alter table public.dream_candidacies
  add column rejection_reasons text[],
  add constraint dream_candidacies_rejection_reasons_shape check (
    case when status = 'rejected'
         then rejection_reasons is not null and array_length(rejection_reasons, 1) >= 1
         else rejection_reasons is null
    end
  );

comment on column public.dream_candidacies.rejection_reasons is
  '#218/D6: the screening criteria this candidacy failed — codes from screening_criteria, validated by screen_candidacy(). Present exactly when status = ''rejected''; cleared by the reopen (appeal) transition.';

-- ── 3. audit_log: the four screening actions ────────────────────────────────────────────
-- Same drop + re-create the CHECKs pattern as 20260815093035. The fund shape extends to
-- the screening actions: edition context required, no report, no penalty. candidacy_id
-- stays deliberately NOT required — ON DELETE SET NULL re-checks constraints, and an
-- audit row must never block a GDPR erasure (same rationale as declare_winner's).
alter table public.audit_log
  drop constraint audit_log_action_check,
  drop constraint audit_log_fund_shape;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen')
  ),
  add constraint audit_log_fund_shape check (
    action not in ('declare_winner','screen_start','screen_pass','screen_reject','screen_reopen')
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

-- ── 4. screen_candidacy(): the one transition path, refusals before any write ───────────
-- INVOKER, service_role-only grant, exactly declare_winner's posture: the only caller is
-- the screen-candidacy edge function (internal service-role, rule 8). Transitions:
--   start  submitted → screening      (the committee takes it up)
--   pass   screening → shortlisted    (re-checks D5's machine-checkable criteria)
--   reject screening → rejected       (reasons required, drawn from screening_criteria)
--   reopen rejected  → screening      (D6: a rejection is appealable)
-- The committee's judgment (plan coherence) arrives as the decision itself; what the
-- database re-checks at pass is the machine-checkable half: identity still verified, no
-- active sanction. Proposal completeness is column NOT NULLs — a row cannot exist
-- incomplete. No transition touches Aura (rule #1).
create function public.screen_candidacy(
  p_candidacy_id uuid,
  p_decision text,
  p_reasons text[] default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidacy public.dream_candidacies%rowtype;
  v_edition public.fund_editions%rowtype;
  v_new_status text;
begin
  select * into v_candidacy from public.dream_candidacies c
   where c.id = p_candidacy_id and c.deleted_at is null
   for update;   -- row lock: two concurrent decisions on one candidacy serialize here
  if not found then
    raise exception 'candidacy not found' using errcode = 'P0001';
  end if;

  -- FOR SHARE, not FOR UPDATE: concurrent screenings on one cycle may interleave, but a
  -- concurrent phase flip (an UPDATE on this row) must wait — so the freeze checks below
  -- cannot be overtaken by the ballot opening mid-decision.
  select * into v_edition from public.fund_editions e
   where e.id = v_candidacy.edition_id
   for share;

  -- D4: screening is an admission gate; once the ballot opens the field is fixed and no
  -- screening decision can overturn anything — mirror of declare_winner's phase refusal.
  if v_edition.phase not in ('candidacy', 'screening') then
    raise exception 'screening out of phase' using errcode = 'P0001';
  end if;
  -- Belt to the phase check, for the operator who declares the window before flipping
  -- phase: a passed voting_starts_at freezes screening even in a lagging phase. A NULL
  -- start does NOT refuse — an undeclared window cannot have opened, and the
  -- fund_editions_ballot_open trigger refuses to enter 'voting' without one.
  if v_edition.voting_starts_at is not null and now() >= v_edition.voting_starts_at then
    raise exception 'ballot already open' using errcode = 'P0001';
  end if;

  if p_decision not in ('start', 'pass', 'reject', 'reopen') then
    raise exception 'unknown decision' using errcode = 'P0001';
  end if;
  if p_decision <> 'reject' and p_reasons is not null then
    raise exception 'reasons only on rejection' using errcode = 'P0001';
  end if;

  if p_decision = 'start' then
    if v_candidacy.status <> 'submitted' then
      raise exception 'invalid transition' using errcode = 'P0001';
    end if;
    v_new_status := 'screening';

  elsif p_decision = 'pass' then
    if v_candidacy.status <> 'screening' then
      raise exception 'invalid transition' using errcode = 'P0001';
    end if;
    -- D5's machine-checkable criteria, re-checked at the moment of admission: the insert
    -- gate proved identity once, but verification and sanctions move between submission
    -- and screening.
    if not public.is_identity_verified(v_candidacy.profile_id) then
      raise exception 'identity not verified' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = v_candidacy.profile_id
        and (p.banned_at is not null
             or (p.suspended_until is not null and p.suspended_until > now()))
    ) then
      raise exception 'moderation sanction active' using errcode = 'P0001';
    end if;
    v_new_status := 'shortlisted';

  elsif p_decision = 'reject' then
    if v_candidacy.status <> 'screening' then
      raise exception 'invalid transition' using errcode = 'P0001';
    end if;
    if p_reasons is null or array_length(p_reasons, 1) is null then
      raise exception 'rejection requires reasons' using errcode = 'P0001';
    end if;
    -- D6: the reason is drawn from the STATED criteria — a code outside the published
    -- table is not a reason a candidate can be told and can fix.
    if exists (
      select 1 from unnest(p_reasons) r
      where r not in (select sc.code from public.screening_criteria sc)
    ) then
      raise exception 'unknown criterion' using errcode = 'P0001';
    end if;
    v_new_status := 'rejected';

  else  -- reopen: D6's appeal path, re-entering screening before the field is fixed
    if v_candidacy.status <> 'rejected' then
      raise exception 'invalid transition' using errcode = 'P0001';
    end if;
    v_new_status := 'screening';
  end if;

  -- The writes — status (+ reasons) and the audit row, one transaction: a failure in
  -- either statement leaves neither behind.
  update public.dream_candidacies c
     set status = v_new_status,
         rejection_reasons = case when v_new_status = 'rejected' then p_reasons end
   where c.id = p_candidacy_id;
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'screen_' || p_decision, v_candidacy.edition_id, p_candidacy_id,
          case when p_decision = 'reject'
               then 'criteria not met: ' || array_to_string(p_reasons, ', ')
               else format('%s → %s', v_candidacy.status, v_new_status) end);

  return v_new_status;
end;
$$;

comment on function public.screen_candidacy(uuid, text, text[]) is
  'FUND-52/#218: the one screening transition path — start | pass | reject | reopen. Refuses (P0001, no write) out of phase or once the ballot opens (D4), on an invalid transition, at pass when identity is unverified or a sanction is active (D5), and at reject without reasons drawn from screening_criteria (D6). Service-role only. Zero Aura (rule #1).';

revoke execute on function public.screen_candidacy(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.screen_candidacy(uuid, text, text[]) to service_role;

-- is_identity_verified was granted to authenticated only (20260617225450 revoked PUBLIC);
-- screen_candidacy runs as service_role and calls it, so the grant must exist explicitly
-- (the candidacy_tally precedent, 20260815093035).
grant execute on function public.is_identity_verified(uuid) to service_role;

-- ── 5. The ballot converges on the screened set ─────────────────────────────────────────
-- 20260815090015's header: "When #218 lands and screening moves statuses, this set
-- converges on the screened set." That convergence is now real, in the predicate's one
-- home (#383): on the ballot = screened in ('shortlisted') plus the declared 'winner'.
-- submitted/screening rows become owner-visible only (m7's own table comment — "accepted
-- are public to members" — finally matches the code), unvotable, and uncounted by the
-- ballot minimum, which thereby counts SCREENED candidacies as its column comment always
-- said. All five call sites follow without an edit.
create or replace function public.is_on_ballot(c public.dream_candidacies)
returns boolean
language sql
immutable
as $$
  select c.deleted_at is null
     and c.status in ('shortlisted','winner')
$$;

-- The IMMUTABLE contract from 20260815164035: a body change invalidates the partial
-- index built on the old behaviour — rebuild it so the index serves the screened set.
drop index public.dream_candidacies_list_feed;
create index dream_candidacies_list_feed
  on public.dream_candidacies (edition_id, created_at desc, id desc)
  where public.is_on_ballot(dream_candidacies);

comment on function public.is_on_ballot(public.dream_candidacies) is
  '#383/#218: THE definition of "on the ballot" — the screened set: shortlisted or winner, not soft-deleted. Visible field, votable set, ballot minimum, and (composed with status <> ''winner'') declaration eligibility all read from here. IMMUTABLE + used in a partial-index predicate: any body change must drop/re-create dream_candidacies_list_feed in the same migration.';
