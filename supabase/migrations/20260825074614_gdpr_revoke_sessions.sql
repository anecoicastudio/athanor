-- Revoke every live session of one user, by user id — erasure cascade step (1) (#542).
--
-- Step (1) of the GDPR erasure cascade (supabase/functions/erasure-job/index.ts, 10 §5.4) has to
-- revoke the subject's sessions BEFORE anything is deleted, because deleting a user does not
-- invalidate a token already issued to them. It was wired to auth-js
-- `admin.signOut(profileId, 'global')` — but that call takes «A valid, logged-in JWT» and sends
-- its first argument as the `Authorization` bearer to GoTrue's `/logout`, overwriting the
-- service key. A UUID is not a JWT, so every call 401'd, the resolved `{ error }` flipped
-- `degraded`, and every live erasure landed `failed` with the member's sessions still open.
--
-- There is no by-id replacement to move to. auth-js 2.112.2 (what the edge function's deno.lock
-- actually resolves) exposes exactly three by-id admin calls — getUserById, updateUserById,
-- deleteUser — plus MFA-factor and passkey deletes; GoTrue's `/admin` router registers no
-- session route of any kind. The one admin call that WOULD take the sessions with it is
-- deleteUser, and that is the legal-gated step (4) — precisely the step that may not run yet.
-- Step (1) has to stand on its own, so the revoke happens where the sessions actually live.
--
-- This is GoTrue's own global logout, statement for statement (internal/models/sessions.go,
-- `Logout`): delete the user's rows from auth.sessions. auth.refresh_tokens follows by cascade
-- (refresh_tokens_session_id_fkey). The second delete is the belt — a refresh token whose
-- session_id is NULL predates the sessions table and no cascade reaches it. There are none on
-- either project today, and this function is not the place to depend on that staying true.
--
-- What this does NOT do, because nothing can: an access token already minted stays valid until
-- it expires. That is stateless JWT and is equally true of GoTrue's own /logout (its README says
-- so). What the revoke buys is that no NEW access token can be minted for the subject.
--
-- SECURITY DEFINER because it is the only way, not the convenient one (rules/supabase-db.md):
-- auth.sessions is owned by supabase_auth_admin, carries RLS with zero policies, and
-- `service_role` — the role the erasure job reaches Postgres as — holds no DELETE on it
-- (verified against staging: has_table_privilege('service_role','auth.sessions','delete') is
-- false). `postgres`, which owns this function, holds both the DELETE and BYPASSRLS.
--
-- In `public` rather than `athanor` because the edge function calls it through PostgREST, and
-- config.toml exposes only `public` + `graphql_public`. That makes the default ACL the whole
-- attack surface — see the revoke below.

create or replace function public.gdpr_revoke_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;

  -- Orphans only (session_id is NULL); the cascade above has already taken the rest.
  -- refresh_tokens.user_id is varchar in GoTrue's schema, not uuid — hence the cast.
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  -- Zero is a clean result, not a failure: a member who was never signed in on any device has
  -- no session to revoke, and the caller must not read that as a step that did not run.
  return v_deleted;
end;
$$;

comment on function public.gdpr_revoke_sessions(uuid) is
  'GDPR erasure step (1) (#542): revoke every live session of one user BY USER ID, because '
  'auth-js admin.signOut takes a JWT and GoTrue exposes no by-id session route. Deletes the '
  'subject''s auth.sessions rows (refresh_tokens follow by cascade, plus a sweep for '
  'session_id-NULL orphans) and returns how many sessions were revoked — zero is a clean '
  'result. SECURITY DEFINER because service_role holds no DELETE on auth.sessions. '
  'Service-role only; idempotent.';

-- #409 / rule 8. A new function is born with EXECUTE to PUBLIC, and the `pg_default_acl` 'f' row
-- adds anon and authenticated on top. On this function that default IS the vulnerability: it
-- signs any user out by id, so leaving it would let any signed-in member — and the
-- unauthenticated internet — end anyone else's sessions at will. 0121 pins anon's and PUBLIC's
-- executable surface by name; the grant below is the only privilege that survives.
revoke all on function public.gdpr_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_revoke_sessions(uuid) to service_role;
