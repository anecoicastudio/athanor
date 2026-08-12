-- Pin service_role's execute on the #273 functions, in BOTH directions.
--
-- 20260616071318 records why this file has to exist: on a hosted project, `alter default
-- privileges` auto-grants EXECUTE on new functions to service_role, so a bare
-- `revoke execute ... from public, anon, authenticated` leaves service_role able to call them
-- there — while on a fresh CI/local Postgres the same revoke leaves only the owner. The two
-- environments then disagree about who may call what, and CI is the one that tells you, late.
-- That migration hit it as `42501 permission denied for function run_momenti_matcher`; this
-- branch hit exactly the same wall in pgTAP 0028 on `athanor.seeking_to_identity`.
--
-- 20260812145446 left four functions in that ambiguous state. Resolving each by what it is for,
-- rather than granting them all:
--
--   · public.expire_momento_proposals() — GRANT. It is the ops-callable half of the matcher
--     («the deck went stale, drain it now»), the same posture run_momenti_matcher already has
--     since 20260616071318. Granting it means the release runbook can run it with the service
--     key instead of needing a superuser session.
--   · athanor.tag_intersect / seeking_to_identity / pair_not_blocked — REVOKE. They are
--     implementation details of the matcher and the deck RPC, both of which are DEFINER and
--     therefore call them as the owner regardless. Nothing outside this schema should reach
--     them, and on hosted, today, service_role can. Closing that is the point of this file:
--     `revoke ... from public` never covered service_role's own grant.
--
-- After this, the answer to "who may execute these?" is identical on staging, on production and
-- in CI, and it is written down rather than inherited from a default.
grant execute on function public.expire_momento_proposals() to service_role;

revoke execute on function athanor.tag_intersect(text[], text[]) from service_role;
revoke execute on function athanor.seeking_to_identity(text[]) from service_role;
revoke execute on function athanor.pair_not_blocked(uuid, uuid) from service_role;
