-- #574 — a chat message joins the reports vocabulary.
--
-- `reports.target_type` has admitted person | post | behavior since 20260620011307. A report
-- filed from inside a conversation can therefore only name the PERSON
-- (`apps/native/src/app/(modal)/chat.tsx`, the overflow menu's report arm) — never the
-- message, and never the image. #155 shipped private 1:1 images on 2026-08-27, which makes
-- the gap concrete: the hardest surface to moderate is the one where a report cannot point at
-- what it is about.
--
-- Constraint name: the migration that created it declared an INLINE column CHECK and never
-- named it, so the name is Postgres's implicit one. Queried on the hosted staging catalog
-- before writing this (`pg_constraint` / `aclexplode`-style read, not information_schema):
--   reports_target_type_check | CHECK ((target_type = ANY (ARRAY['person','post','behavior'])))
-- Hosted and migration agree here — no drift to reconcile. The same query is owed against
-- PRODUCTION at release, because hosted projects drift wider than the migrations that declare
-- them and this DROP is by name.
--
-- Nothing else in the table's security surface moves: no policy in this schema mentions
-- `target_type` (the three `reports_*` policies key on `reporter_id` and `athanor.is_admin()`),
-- the grant is table-level (`0121:115` — SELECT,INSERT to authenticated), and `reports` sits
-- OUTSIDE #106's restrictive `active_write_*` net on purpose: reporting is a safety carve-out
-- that survives a suspension (`0091:203-206`).
--
-- `target_id` still has no FK — deliberately, since 20260620011307. A message erased by the
-- GDPR job therefore leaves a report pointing at nothing, and the evidence read path
-- (20260831153525) resolves that to "no longer available" rather than to a dangling read.

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('person', 'post', 'behavior', 'message'));

comment on constraint reports_target_type_check on public.reports is
  '#574: person | post | behavior | message. A message target names one row of public.messages '
  '(no FK, as since 20260620011307). Mirrored in packages/schemas REPORT_TARGET_TYPES, from '
  'which packages/schemas/src/admin.ts now DERIVES the admin queue''s enum rather than '
  're-declaring it.';
