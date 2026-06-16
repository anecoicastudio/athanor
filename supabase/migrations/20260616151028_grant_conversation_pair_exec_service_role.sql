-- M5 conversations-chat — CI parity fix.
--
-- `create_conversation_pair` is a SECURITY DEFINER, internal-only helper: 20260616123408
-- revoked execute from public/anon/authenticated so clients can never call it directly
-- (asserted in tests/0029 → authenticated gets 42501). Production reaches it only through
-- the DEFINER functions that own it (accept_momento, get_or_create_conversation), which run
-- as the function owner — so they never needed a direct grant.
--
-- On the hosted project service_role retained execute via Supabase's default privileges, so
-- the pgTAP seeds that create a pair as `set local role service_role` (0029/0030) passed
-- locally/hosted. A vanilla CI Postgres has no such default grant, so those seeds failed with
-- `permission denied for function create_conversation_pair`, aborting both test files.
--
-- service_role is the trusted server identity (it already holds `grant all` on conversations
-- /messages here), so granting it execute on the server-side creator is faithful and makes
-- every environment behave identically. anon/authenticated remain revoked (clients still 42501).
grant execute on function public.create_conversation_pair(uuid, uuid, public.conversation_source)
  to service_role;
