-- momento_proposals — strip the hosted default-privilege grants from `authenticated`
-- (mirrors event_attendance_revoke_client_mutations / event_live_stats_revoke_client_writes).
-- On HOSTED Supabase, `alter default privileges` auto-grants the FULL table privilege set
-- (select/insert/update/delete/…) to `authenticated` when a public table is created. So the
-- prior migration's COLUMN-LEVEL grants (`grant select (cols)` / `grant update (status)`) were
-- ADDITIVE on top of a whole-table grant — they did NOT make affinity unreadable or proposals
-- insert-proof. Result on hosted: a client could read `affinity` and forge proposals — defeating
-- invariants 05 §7 #2 (matcher-only insert) & #3 (server-only affinity).
--
-- Fix: revoke the whole-table ACL from `authenticated`, then re-state ONLY the precise column
-- grants. After this, `authenticated` has column SELECT on everything EXCEPT affinity, and column
-- UPDATE on status only — so affinity/reasons/candidate_id/daily_rank are immutable and INSERT is
-- denied at the grant layer (42501) on BOTH hosted and CI replay (local has no auto-grant, so the
-- revoke is a harmless no-op there and the re-grant restores the same shape). Service role keeps ALL.

revoke all on table public.momento_proposals from authenticated;

-- SELECT excludes affinity → the client literally cannot reference the score column.
grant select (id, user_id, candidate_id, reasons, status, proposed_on, passed_until, daily_rank, created_at, updated_at)
  on table public.momento_proposals to authenticated;
-- UPDATE only the status column → candidate_id / reasons / affinity / daily_rank are immutable for clients.
grant update (status) on table public.momento_proposals to authenticated;
-- NO insert grant to authenticated — proposals are matcher-only (invariant #2).
