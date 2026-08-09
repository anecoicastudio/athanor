-- Stop detecting the service path through a request-scoped JWT claim.
--
-- milestone_helps_guard and favor_offers_guard opened with
-- `(select auth.role()) = 'service_role'`. auth.role() reads the `role` claim out of
-- request.jwt.claims. That works today and this migration does NOT change who bypasses:
-- measured against the local stack, a `sb_secret_…` caller arrives at PostgREST already
-- carrying `{"role":"service_role"}` (the gateway exchanges the key before PostgREST sees it),
-- so auth.role() returns 'service_role' and current_user is 'service_role' at the same time.
--
--   sb_secret_…      -> claims role=service_role, auth.role()=service_role, current_user=service_role
--   publishable key  -> claims role=anon,         auth.role()=anon,         current_user=anon
--
-- This is therefore a HARDENING, not a repair, and nothing observable changes. Three reasons
-- it is still worth doing:
--
--   1. auth.role() is deprecated by Supabase.
--   2. current_user is what PostgREST actually SET LOCAL ROLEs to. It is a property of the
--      session, not a value parsed out of a request, so it cannot be shaped by anything a
--      caller sends. The two agree today only because the gateway keeps them in step; the
--      guard should not depend on that continuing.
--   3. `service_role` is NOLOGIN, so current_user = 'service_role' is reachable only through
--      PostgREST's role switch or an explicit `set local role` in a test — never by a client.
--
-- Why current_user and not the alternatives:
--   session_user  — PostgREST connects as `authenticator` and switches role per request, so
--                   session_user is never 'service_role' and the bypass would never fire.
--   pg_has_role   — true for both `postgres` and `authenticator`, so it would hand the bypass
--                   to postgres and break the pgTAP suites that rely on postgres being
--                   restricted (0081 walks offered -> accepted -> completed as postgres).
--   auth.jwt()->>'role' — same request-scoped claim dependency, just spelled out.
--
-- SECURITY INVOKER is load-bearing and preserved: under DEFINER, current_user would be the
-- function owner and every caller would look like the service role.
--
-- ONE REAL NARROWING, deliberate: claims are session GUCs and survive into a SECURITY DEFINER
-- function, so a service-role client calling a DEFINER RPC owned by postgres used to bypass;
-- under current_user it is `postgres` inside that function and the guard now applies. No
-- current writer is affected — public.confirm_milestone_help is SECURITY INVOKER and
-- public.profile_stat_counts is read-only — but the deferred erasure cascade
-- (functions/erasure-job/logic.ts) is the obvious future one: if pseudonymization lands as a
-- DEFINER RPC rather than a direct PostgREST write, it must bypass explicitly rather than
-- expecting this check to fire.
--
-- Bodies are otherwise verbatim from 20260614131843_milestone_helps.sql:93 and
-- 20260615081559_favor_offers.sql:70, which are applied and cannot be edited (rule 7).

create or replace function public.milestone_helps_guard()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;  -- engine/service path unrestricted (detect, not authorize — rule #2 note)
  end if;
  if new.helper_id     is distinct from old.helper_id
     or new.milestone_id is distinct from old.milestone_id
     or new.type        is distinct from old.type
     or new.message     is distinct from old.message
     or new.link        is distinct from old.link then
    raise exception 'owner may change only status' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (
         (old.status = 'offered'  and new.status in ('accepted', 'declined'))
      or (old.status = 'accepted' and new.status = 'completed')
    ) then
      raise exception 'illegal help status transition % -> %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- Re-asserted after the replace, matching 20260808074301_pg_net_apikey_header.sql:75,98.
-- CREATE OR REPLACE preserves the ACL, so this is defence in depth rather than a fix.
revoke execute on function public.milestone_helps_guard() from public, anon, authenticated;

create or replace function public.favor_offers_guard()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;  -- engine/service path unrestricted (detect, not authorize — rule #2 note)
  end if;
  if new.actor_id            is distinct from old.actor_id
     or new.target_id        is distinct from old.target_id
     or new.need             is distinct from old.need
     or new.need_milestone_id is distinct from old.need_milestone_id
     or new.created_at       is distinct from old.created_at then
    raise exception 'actor may only withdraw (soft-delete) a favor' using errcode = '42501';
  end if;
  return new;
end; $$;

revoke execute on function public.favor_offers_guard() from public, anon, authenticated;
