-- event_live_stats is service-role-write ONLY (never client-written).
-- Supabase's ALTER DEFAULT PRIVILEGES grants anon/authenticated all table privileges
-- on new public tables; the prior migration only added a SELECT grant on top of those,
-- so a client UPDATE passed the grant check and was then silently filtered to zero rows
-- by RLS (no UPDATE policy) instead of being denied outright. Mirror the events table
-- (which revokes all from anon first) so client INSERT/UPDATE/DELETE are denied at the
-- grant layer with 42501 — deterministic, regardless of RLS row-matching semantics.

revoke all on table public.event_live_stats from anon, authenticated;
grant select on table public.event_live_stats to anon, authenticated;
