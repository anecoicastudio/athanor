-- #230 — public progress updates bound to the cycle.
-- FUND-26 («the community can follow the project's progress») · docs/FUND-SPEC.md
-- §"Realization" · divergence D-14. #228's migration named this seam three times
-- («#230 owns progress»); this is it.
--
-- WHAT THIS IS. The winner's ongoing narrative while they realize the dream: short public
-- notes, each bound to the cycle and optionally to the plan phase it is about. The trail
-- the fund promised did not end at selection any more — #228/#229 carry it to the
-- published plan — but a plan is a promise stated once, and FUND-26 asks for the months
-- after it.
--
-- WHAT THIS IS NOT — AND THE ISSUE'S THIRD BULLET IS WRONG ABOUT IT. The issue says
-- progress «gates the definition of "realized" that closure checks against». It does not,
-- and nothing here wires it that way. close_cycle() (20260815215924:170-273) takes
-- p_outcome and p_evidence as OPERATOR-SUPPLIED parameters; the mechanical
-- «no verification, no money» gate is #231's realization_plan_phases.verified_at, and it
-- gates a TRANCHE RELEASE, not the closure determination. FUND-SPEC lists FUND-26
-- (progress, this), FUND-31 (closure) and FUND-53 (release) as three separate rows.
-- Making a public note load-bearing for closure would let the author declare their own
-- realization in prose — the exact inversion of «realisation is derived, never declared».
-- Progress updates are EVIDENCE AND TRANSPARENCY. They gate nothing.
--
-- THIS IS USER CONTENT, unlike the plan. #228 omitted deleted_at deliberately («a
-- published plan is the public commitment tranches release against; withdrawing one is
-- not a member gesture»). An update is the opposite: a note the author wrote, which they
-- may withdraw. So deleted_at, soft-deleted by the author, hidden from every public read.
-- The CASCADE from profiles is the erasure path; the phase link is ON DELETE SET NULL for
-- the same reason fund_payout_ledger.plan_phase_id is — the pointed-at plan CASCADEs with
-- its candidacy on erasure, and an update whose phase no longer exists is a legitimate row.
--
-- PROSE ONLY, NO MEDIA. A photo would need a bucket, a signing path and a moderation
-- surface; #241's storage policies and the report/moderation net are what would have to
-- grow first. One text column now is honest; a half-wired image column would not be.
--
-- NO VANITY METRICS (rule #3). No reaction count, no view count, no column that could
-- become one. The community follows the project; it does not score it.
--
-- Zero Aura (rule #1): posting an update earns nothing, exactly as contributing money
-- does not. The table joins aura-boundary.test.ts's MONEY_TABLES and pgTAP 0116 asserts
-- the same claim in-db.

-- ── 1. The table ────────────────────────────────────────────────────────────────────────
-- Bound to the CYCLE (the issue's word), not to the plan: a cycle has one plan and one
-- winner, so edition_id is the shortest true binding, and it keeps an update readable
-- after a GDPR erasure has taken the plan away. plan_phase_id is the optional refinement
-- — «this is about phase 2» — and a trigger below refuses a phase from another cycle.
create table public.realization_updates (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.fund_editions (id) on delete restrict,
  -- The author. Pinned to the cycle's confirmed winner by the trigger below AND by the
  -- insert policy's WITH CHECK — RLS says «the caller», the trigger says «the winner»,
  -- and neither is the other's restatement: the trigger also binds a service-role write.
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Optional, and nullable forever: most updates are about the project, not about one
  -- tranche. SET NULL rather than CASCADE — an erasure that removes the plan must not
  -- silently remove the public trail the community was following.
  plan_phase_id uuid references public.realization_plan_phases (id) on delete set null,
  -- Bounded prose, CHECK-mirrored by the Zod schema character for character (#228's
  -- discipline): this text is rendered publicly, and an unbounded column would let a row
  -- exist that its own schema refuses to parse. 2000 is the phases' verification_criteria
  -- bound — an update is a note, not a second plan.
  body text not null
    check (btrim(body) <> '' and char_length(body) <= 2000),
  -- The author withdraws their own note. Public reads exclude it; nothing hard-deletes it,
  -- so #234's recorded history keeps a row where one existed.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.realization_updates is
  '#230/FUND-26: the winner''s public progress updates during realization — bound to the cycle, optionally to the plan phase they are about. Written by the confirmed winner while the cycle is in ''realization'' (RLS + trigger), world-readable from the moment they are posted, author-soft-deletable. NOT a gate: closure''s outcome is close_cycle()''s operator-supplied parameter and the release gate is #231''s verified_at — an update is evidence, never a declaration. No reaction or view count, ever (rule #3). Zero Aura (rule #1).';

comment on column public.realization_updates.plan_phase_id is
  '#230: the plan phase this note is about, or null — most updates are about the project rather than one tranche. Trigger-checked to belong to this cycle''s plan; SET NULL on erasure, so a note outlives the phase it pointed at.';

comment on column public.realization_updates.deleted_at is
  '#230: the author withdrew this note. Every public read excludes it; nothing hard-deletes the row.';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────────────────
-- The feed's exact shape (rule #9): one cycle, newest first, (created_at desc, id desc)
-- as the keyset, live rows only. Partial on deleted_at because a withdrawn note is never
-- in the page this index serves.
create index realization_updates_feed
  on public.realization_updates (edition_id, created_at desc, id desc)
  where deleted_at is null;

-- FK indexes: the profiles CASCADE (erasure) and the phase SET NULL both scan otherwise.
create index realization_updates_profile on public.realization_updates (profile_id);
create index realization_updates_plan_phase
  on public.realization_updates (plan_phase_id)
  where plan_phase_id is not null;   -- partial: most notes carry no phase

create trigger realization_updates_touch_updated_at
  before update on public.realization_updates
  for each row execute function public.touch_updated_at();

-- ── 3. The note binds the cycle's confirmed winner, and its phase to that cycle ──────────
-- Two facts, one trigger, both refusing before any write (the binds_winner / within_basis
-- idiom). RLS already says both for a CLIENT; this says them for every writer, which is
-- the reason #228 put the winner binding in a trigger rather than trusting the policy.
--
-- Scoped to the binding columns on UPDATE (edition_id, profile_id, plan_phase_id): editing
-- a body or withdrawing a note must not re-run the winner check, because a GDPR erasure
-- SET NULLs fund_editions.winner_candidacy_id and would otherwise make a soft delete fail
-- on exactly the rows an erasure is trying to clear.
create function public.realization_updates_binds_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_winner uuid;
  v_author uuid;
  v_phase_edition uuid;
begin
  select e.winner_candidacy_id into v_winner
    from public.fund_editions e
   where e.id = new.edition_id;
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_winner is null then
    raise exception 'no winner declared' using errcode = 'P0001';
  end if;
  select c.profile_id into v_author
    from public.dream_candidacies c
   where c.id = v_winner;
  if v_author is distinct from new.profile_id then
    raise exception 'not the cycle winner' using errcode = 'P0001';
  end if;

  -- An attribution that can lie is worse than none (#228's words about the ledger
  -- linkage): a note filed under another cycle's phase would make #237's published page
  -- show one project's progress inside another's plan.
  if new.plan_phase_id is not null then
    select p.edition_id into v_phase_edition
      from public.realization_plan_phases f
      join public.realization_plans p on p.id = f.plan_id
     where f.id = new.plan_phase_id;
    if not found then
      raise exception 'plan phase not found' using errcode = 'P0001';
    end if;
    if v_phase_edition <> new.edition_id then
      raise exception 'plan phase belongs to another cycle' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger realization_updates_binds_winner
  before insert or update of edition_id, profile_id, plan_phase_id
  on public.realization_updates
  for each row execute function public.realization_updates_binds_winner();

-- ── 4. Grants: SELECT to the world, the authoring columns by name ───────────────────────
-- Hosted ALTER DEFAULT PRIVILEGES auto-grants client writes on new public tables, so a
-- blocked write would silently affect 0 rows instead of raising 42501. Strip everything,
-- grant back exactly what the author needs (#228 §5 / #229 §2).
revoke all on table public.realization_updates from anon, authenticated;
grant select on table public.realization_updates to anon, authenticated;
grant all on table public.realization_updates to service_role;

grant insert (edition_id, profile_id, plan_phase_id, body)
  on table public.realization_updates to authenticated;
-- deleted_at is granted BECAUSE withdrawal is an UPDATE of it and there is no delete
-- grant: a public note is never hard-deleted by its author. edition_id and profile_id are
-- absent — a note never re-targets a cycle or changes hands.
grant update (body, plan_phase_id, deleted_at)
  on table public.realization_updates to authenticated;

alter table public.realization_updates enable row level security;

-- ── 5. Policies ─────────────────────────────────────────────────────────────────────────
-- PUBLIC READ IS THE POINT (FUND-26). Signed out included: #237's per-cycle page renders
-- this trail as anon, the same audience that reads the published plan. No `published`
-- flag exists to gate on — a note IS published when it is posted, and the state that
-- controls whether one can exist at all is the cycle's phase, checked on write.
create policy "realization_updates_select_live"
  on public.realization_updates for select
  to anon, authenticated
  using (deleted_at is null);

-- The author reads their own withdrawn notes; an admin reads everything. Both exist so a
-- withdrawal is recoverable by a human rather than only by a service-role query.
create policy "realization_updates_select_own"
  on public.realization_updates for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "realization_updates_select_admin"
  on public.realization_updates for select
  to authenticated
  using ((select athanor.is_admin()));

-- WRITE: the winner, during realization. The phase predicate is what «bound to the cycle»
-- means in time — realization begins when publish_realization_plan() moves the cycle there
-- (#229) and ends at close_cycle(). Before it there is no published commitment to report
-- against; after it the cycle's account is closed and its trail is frozen, which is what
-- makes the trail worth reading.
create policy "realization_updates_insert_own_realizing"
  on public.realization_updates for insert
  to authenticated
  with check (
    (select auth.uid()) = profile_id
    and deleted_at is null
    and exists (
      select 1 from public.fund_editions e
       where e.id = edition_id
         and e.phase = 'realization'
    )
  );

-- USING and WITH CHECK both (rule 2). They differ in exactly one place, deliberately:
-- USING carries `deleted_at is null` (a withdrawn note is not editable again) and WITH
-- CHECK does not (setting deleted_at IS the withdrawal). profile_id is pinned on both
-- sides even though it is not a granted column, so the policy never relies on a grant for
-- its own predicate.
create policy "realization_updates_update_own_realizing"
  on public.realization_updates for update
  to authenticated
  using (
    (select auth.uid()) = profile_id
    and deleted_at is null
    and exists (
      select 1 from public.fund_editions e
       where e.id = edition_id
         and e.phase = 'realization'
    )
  )
  with check (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.fund_editions e
       where e.id = edition_id
         and e.phase = 'realization'
    )
  );
-- NO delete policy and no delete grant: withdrawal is deleted_at, and a public record of
-- a public project does not vanish on request. GDPR erasure removes the profile, which
-- CASCADEs these rows — that path is #240's and needs no client delete.
