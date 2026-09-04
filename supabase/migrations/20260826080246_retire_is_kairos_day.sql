-- Retire the legacy premium-day flag. «Kairos» is a pre-Athanor name; the live
-- flag has been `is_athanor_day` since the events table split premium into twin
-- columns, and every reader treats premium as the OR of the two
-- (apps/native/src/lib/event-row.ts, apps/web/components/public-event-view.tsx).
-- Folding the legacy flag into `is_athanor_day` therefore changes no behaviour:
-- an event that was premium stays premium, and the chip logic collapses to one
-- column. Production holds no rows (replayed 2026-08-10); staging is seeded and
-- disposable.
--
-- Grant surface: the column carried no client INSERT/UPDATE privilege
-- (20260819041755 scoped `events` client writes by column and excluded it), so
-- dropping it removes nothing a client could reach. The column-scoped grant
-- assertion in supabase/tests/0020_events_rls.test.sql is updated in this
-- change; the naming residue in the two earlier applied migrations is recorded
-- in supabase/MIGRATIONS-ERRATA.md, since applied migrations are append-only.

update public.events
set is_athanor_day = true
where is_kairos_day;

alter table public.events
drop column is_kairos_day;
