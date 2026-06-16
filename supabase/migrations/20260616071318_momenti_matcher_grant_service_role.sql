-- The matcher is "service-role internal" (11 §3.2) + cron-invoked (postgres context). The original
-- momenti_matcher migration revoked execute from public/anon/authenticated but relied on service_role
-- keeping execute "as the owner's default" — which holds on HOSTED (alter default privileges auto-grants
-- to service_role) but NOT on a fresh CI/local Postgres, where after `revoke ... from public` only the
-- owner (postgres) retains execute. Result: pgTAP 0028 (which calls the matcher under `set role
-- service_role`) failed in CI with `42501 permission denied for function run_momenti_matcher`.
-- Grant execute to service_role EXPLICITLY so the matcher runs identically on hosted and CI. anon +
-- authenticated stay revoked (clients never invoke the matcher). Idempotent on hosted.
grant execute on function public.run_momenti_matcher() to service_role;
grant execute on function public.momento_reasons(text, text[], text[], text[]) to service_role;
