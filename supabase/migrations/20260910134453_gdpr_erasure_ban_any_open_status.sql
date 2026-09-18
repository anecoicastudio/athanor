-- #733, third half — ONE predicate. /code-review on 20260910132434 found the four consumers
-- disagreeing about what "open" means: the sticky trigger, the partial index and
-- athanor.is_active() all read `status <> 'done'`, while the request trigger fired only WHEN
-- status = 'requested' and the backfill covered only requested/processing. A member holding a
-- pre-existing `partial` or `failed` row — production has such rows, RELEASE-RUNBOOK §7.5 —
-- would therefore have kept sign-in while every social write was denied, with no copy anywhere
-- to say why. This file makes the rule the same everywhere:
--
--     a gdpr_erasure_requests row whose status is not 'done'  ⇒  the auth user is banned.
--
-- 1. The request trigger fires on any INSERT or UPDATE OF status that lands on a non-done
--    status. Idempotent (GREATEST), so a row walking requested → processing → failed → requested
--    re-asserts the same value at every step, and a legacy-shaped row inserted directly as
--    `failed` bans too.
-- 2. The backfill covers the same set, once. On production that bans the members whose
--    pre-#107 requests stopped at `partial` — accounts that asked to be erased on a date the
--    row records, and that §7.5's reconcile finishes. Named as a rider on #80 for the release.
--
-- 20260910130552's header still describes the trigger as AFTER INSERT and prescribes a bare
-- `banned_until = null` as the withdrawal act; both are recorded in MIGRATIONS-ERRATA.md.

drop trigger gdpr_erasure_request_bans_signin on public.gdpr_erasure_requests;
create trigger gdpr_erasure_request_bans_signin
  after insert or update of status on public.gdpr_erasure_requests
  for each row when (new.status <> 'done')
  execute function public.gdpr_ban_on_erasure_request();

comment on function public.gdpr_ban_on_erasure_request() is
  'AFTER INSERT OR UPDATE OF status on gdpr_erasure_requests, WHEN the new status is not done (#733, 20260910134453): sets auth.users.banned_until to now() + 876000h — moderation-enforce''s BAN_FOREVER — so sign-in and refresh fail from the moment a request exists or is re-queued, not from the nightly erasure. Same predicate as gdpr_keep_erasure_ban() and athanor.is_active(). DEFINER because service_role holds no UPDATE on auth.users (as gdpr_revoke_sessions). Lifting is an operator act in two statements, RELEASE-RUNBOOK §7.5.';

update auth.users u
   set banned_until = greatest(u.banned_until, now() + interval '876000 hours')
  from public.gdpr_erasure_requests r
 where r.profile_id = u.id
   and r.status <> 'done';
