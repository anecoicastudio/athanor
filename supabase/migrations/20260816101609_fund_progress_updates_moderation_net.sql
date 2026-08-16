-- #230 — realization_updates joins #106's restrictive write net.
--
-- A separate migration from 20260816095120 only because that one is already applied;
-- append-only is the rule, not a judgement about the two belonging together.
--
-- WHY THIS TABLE AND NOT THE PLAN. #228/#229's realization_plans and
-- realization_plan_phases carry no active_write_* net, and that is right for them: a plan
-- is a commitment the money releases against, and a moderation action must not be able to
-- freeze a funded project's paperwork. A progress update is the opposite kind of object —
-- a member speaking, in public, to everyone. The nearest neighbour in #106's own list is
-- dream_candidacies, which is in it for exactly this reason.
--
-- A suspension is temporary and the trail resumes with it; nothing about the money moves,
-- because releases are #231's service-side path and read no note. What the net buys is
-- that a banned member cannot keep publishing from the fund's most visible surface.
--
-- Three policies, the #106 shape verbatim (Postgres has no ALL-minus-SELECT). READS STAY
-- OPEN, deliberately: suspended is not erased, and the community's trail is not the
-- author's to lose. DELETE carries a moot restriction — there is no delete grant on this
-- table — and it is created anyway so the matrix stays 3-per-table rather than becoming a
-- list with exceptions to remember.
create policy active_write_insert on public.realization_updates
  as restrictive for insert
  to authenticated
  with check ((select athanor.is_active()));

create policy active_write_update on public.realization_updates
  as restrictive for update
  to authenticated
  using ((select athanor.is_active()))
  with check ((select athanor.is_active()));

create policy active_write_delete on public.realization_updates
  as restrictive for delete
  to authenticated
  using ((select athanor.is_active()));
