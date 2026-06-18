-- circle_memberships is a never-client-written (SRW) cache. On hosted, ALTER DEFAULT PRIVILEGES
-- auto-grants INSERT/UPDATE/DELETE to authenticated on new public tables → a client UPDATE/DELETE
-- would silently affect 0 rows (RLS blocks the rows) instead of failing loud with 42501. Strip the
-- writes so a client write fails loud (rule #6; project standard supabase-hosted-default-privileges-revoke;
-- mirrors fund_editions/fund_aggregates). SELECT (granted in the create migration) is unaffected.
revoke insert, update, delete on table public.circle_memberships from anon, authenticated;
