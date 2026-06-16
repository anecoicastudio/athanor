-- event_attendance — revoke the hosted default-privilege client mutations (backend 04 §2.4; mirrors
-- the event_live_stats_revoke_client_writes pattern). On HOSTED Supabase, `alter default privileges`
-- auto-grants the FULL write set (update/delete/truncate/…) to `authenticated` on table creation, so
-- the prior migration's `grant select, insert to authenticated` was ADDITIVE — it did not strip the
-- auto-granted update/delete. Without this revoke, an authenticated UPDATE/DELETE is silently
-- RLS-filtered to 0 rows (there is no update/delete policy) instead of failing 42501 at the grant
-- layer — and local migration replay (CI) diverges from hosted (no auto-grant locally).
--
-- event_attendance is an IMMUTABLE, organizer-INSERT-only record: authenticated keeps SELECT + INSERT
-- (the organizer check-in path, RLS-gated) but must NOT mutate or wipe check-ins. Corrections go
-- through the service role only. This revoke makes the immutability guarantee real at the grant layer
-- (42501) on BOTH hosted and CI, matching the pgTAP 0026 assertions. Service role keeps ALL.

revoke update, delete, truncate on table public.event_attendance from authenticated;
