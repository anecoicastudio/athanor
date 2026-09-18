-- #733, fourth half — the request trigger must not fire on the nightly claim.
--
-- 20260910134453 widened the trigger's WHEN to `new.status <> 'done'` so a legacy-shaped row
-- and the §7.5 re-queue both ban. That also made it fire on claim_erasure_requests' own
-- `requested → processing` step, which buys nothing (the row banned on insert, and the sticky
-- trigger keeps it) and costs a lock edge: the claim holds FOR UPDATE on up to twenty request
-- rows, then this trigger would take row locks on their auth.users rows — the reverse of the
-- order erasure-job's deleteUser takes them (auth.users first, then the request row through
-- the ON DELETE SET NULL of 20260908073545). Reachable exactly where #717 says a pass can
-- outlive its lease. /code-review on 134453 found it.
--
-- A WHEN clause cannot read OLD on an INSERT OR UPDATE trigger, so the guard lives in the body:
-- on UPDATE, only a row coming back from `done` fires — the one transition that can find an
-- account whose ban was legitimately cleared. Every other UPDATE returns before touching
-- auth.users, so no lock is taken. The trigger definition is unchanged.

create or replace function public.gdpr_ban_on_erasure_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only an INSERT, or an UPDATE that brings a row back from `done`, may write auth.users.
  -- The claim (requested → processing), the terminal flips and the re-queue of a partial or
  -- failed row all find the ban already in place (insert, backfill, sticky) and take no lock.
  if tg_op = 'UPDATE' and old.status <> 'done' then
    return new;
  end if;
  update auth.users
     set banned_until = greatest(banned_until, now() + interval '876000 hours')
   where id = new.profile_id;
  return new;
end;
$$;

comment on function public.gdpr_ban_on_erasure_request() is
  'AFTER INSERT OR UPDATE OF status on gdpr_erasure_requests, WHEN the new status is not done (#733): sets auth.users.banned_until to now() + 876000h — moderation-enforce''s BAN_FOREVER — so sign-in and refresh fail from the moment a request exists. On UPDATE it writes only when the row comes back from done (20260910140902): the nightly claim and the terminal flips take no auth.users lock, and the sticky trigger already holds the ban on every other path. Same predicate as gdpr_keep_erasure_ban() and athanor.is_active(). DEFINER because service_role holds no UPDATE on auth.users. Lifting is an operator act in two statements, RELEASE-RUNBOOK §7.5.';
