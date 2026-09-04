-- #241 — 'fundMilestone' leaves the closed notification type set.
--
-- The type shipped with M9 (20260620025158) but never got a producer, and unlike the two other
-- producerless types it is not waiting on one. 'review' and 'projectResponse' are PARKED in
-- packages/schemas: their recipient is a single profile, so only the trigger is missing and each
-- ships with a named surface. 'fundMilestone' is a fund-wide broadcast ("the fund passed €X")
-- with no single recipient, and athanor.enqueue_notification's contract is one-recipient-per-call
-- — which is exactly why 20260701160235:42 SKIPPED fund_aggregates rather than wiring it. What is
-- missing is a mechanism (fan-out-to-many), not a trigger. #127 owns building that fan-out and
-- re-adds the type together with its producer; until then the value is unreachable wiring that
-- widens the type set for nothing.
--
-- Both CHECKs are restated together, matching 20260813162227 (the third migration to do so,
-- after 20260620025158 and 20260813135602). Migrations are append-only, so this is a new one.
--
-- No data migration is needed: 'fundMilestone' rows were counted on BOTH hosted projects
-- (staging and production) before this was written and the count was ZERO in each of
-- notifications and notification_preferences. The staging seed never inserted the type either
-- (seed-staging.sql seeds only moment/dreamMilestone/connection/eventReminder). The deletes
-- below are therefore defensive-for-replay only — they are NOT evidence that rows existed.

-- ── 1. drop any row the closed set is about to reject ────────────────────────────────────
-- Defensive: measured zero on both hosted projects (see header). Present so a replay against
-- some other database narrows the CHECK instead of failing to add it.
delete from public.notifications where type = 'fundMilestone';
delete from public.notification_preferences where type = 'fundMilestone';

-- ── 2. 'fundMilestone' leaves the closed type set ────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder',
                  'projectResponse','connection','moderation','gdprExport'));

alter table public.notification_preferences drop constraint notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder',
                  'projectResponse','connection','moderation','gdprExport'));
