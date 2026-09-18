-- #733 — a pending erasure request bans sign-in at once.
--
-- Tapping «Elimina account» inserts a gdpr_erasure_requests row and the app signs out, but
-- nothing marked the auth user, so the credentials authenticated again until erasure-nightly
-- (20260908071807, 03:47 UTC) deleted the account. A member who deleted at 19:00 and signed in
-- at 19:10 was let back in, with the app's own copy («la eseguiamo ogni notte») as the only
-- explanation. App Review Guideline 5.1.1(v) treats that as "deletion does not delete"; the
-- rows in RELEASE-RUNBOOK §2 (S-13) stated the timing until this landed.
--
-- Shape: an AFTER INSERT trigger on the request table sets auth.users.banned_until, the same
-- column GoTrue's admin API writes for `ban_duration` and the same value moderation-enforce
-- uses for BAN_FOREVER ('876000h'). GoTrue's IsBanned() compares that column to now() on
-- sign-in AND on token refresh, so both doors close in the same transaction as the request —
-- no pg_net hop, no Vault pair that could be missing and turn this into a silent no-op the
-- way an enqueue would.
--
-- SECURITY DEFINER because it is the only way, not the convenient one (rules/supabase-db.md),
-- mirroring 20260825074614 (gdpr_revoke_sessions): auth.users is owned by supabase_auth_admin
-- and service_role holds no UPDATE on it — verified against staging on 2026-09-10,
-- has_table_privilege('service_role','auth.users','update') = false, ('postgres', …) = true.
-- The body touches exactly one column of exactly the row whose id the request names, and the
-- request insert itself is already gated by RLS (profile_id = auth.uid(), status = 'requested').
--
-- Lifting: not a product flow. Cancelling a request is not a feature; if an operator ever
-- withdraws one by hand (RELEASE-RUNBOOK §7.5), the ban has to be cleared in the same act:
-- `update auth.users set banned_until = null where id = …`. A request that lands on the
-- terminal `failed` status leaves the account banned AND intact, which is the correct state
-- for someone who asked to be erased — §7.5 is where that is reconciled, not here.
--
-- GREATEST keeps a longer moderation ban if one is already in place (a banned member may still
-- request erasure — 20260813045347 deliberately leaves GDPR rights ungated by standing).

create or replace function public.gdpr_ban_on_erasure_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set banned_until = greatest(
           coalesce(banned_until, '-infinity'::timestamptz),
           now() + interval '876000 hours')
   where id = new.profile_id;
  return new;
end;
$$;

comment on function public.gdpr_ban_on_erasure_request() is
  'AFTER INSERT on gdpr_erasure_requests (#733): sets auth.users.banned_until to now() + 876000h — moderation-enforce''s BAN_FOREVER — so sign-in and refresh fail from the moment the request exists, not from the nightly erasure. DEFINER because service_role holds no UPDATE on auth.users (as gdpr_revoke_sessions). Lifting is an operator act, see RELEASE-RUNBOOK §7.5.';

-- #409: a trigger function is invoked by the trigger, never called by a role.
revoke execute on function public.gdpr_ban_on_erasure_request() from public, anon, authenticated;

create trigger gdpr_erasure_request_bans_signin
  after insert on public.gdpr_erasure_requests
  for each row execute function public.gdpr_ban_on_erasure_request();
