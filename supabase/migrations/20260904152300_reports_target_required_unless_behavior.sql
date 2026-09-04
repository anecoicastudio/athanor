-- #611 — a report points at something unless it is about behaviour in general.
--
-- 20260620011307:11 declared `reports.target_id uuid` nullable "for 'behavior' (no specific
-- subject)" and for no other reason; packages/schemas/src/report.ts said the same of
-- `reportInput.targetId`. Neither layer enforced it: the type CHECK (`reports_target_type_check`,
-- last re-added by 20260831153523) constrains the TYPE and not the pairing, and the Zod shape was
-- `.nullish()` for every type. So a 'person', 'post' or 'message' report with no target was
-- schema-admitted — a report the admin panel could attribute to nobody. No UI affordance files
-- one (every push site that sets a non-behavior type also sets an id), but the sheet is an
-- expo-router route, so a deep link with the type and no id reached the insert.
--
-- This CHECK holds the line the 0620 comment already drew. It is ONE-DIRECTIONAL on purpose:
-- 'behavior' MAY carry a target (the staging seed files one against a person), the other three
-- MUST. The 'message' target's deliberate lack of an FK (20260831153523:24-26) is about a target
-- that is later erased — target_id stays set and the evidence read path says "no longer
-- available" — not about a null at creation, so the two rules do not meet.
--
-- Hosted state, queried 2026-09-04 before this was written: staging 6 rows, 0 violating,
-- 1 'behavior' row with a target (which this must and does permit); production 0 rows. Nothing
-- to backfill, so the constraint is added VALID and every existing row is checked on apply.
--
-- Zod mirror: packages/schemas/src/report.ts `reportInput` refines the same rule, and
-- packages/api/src/reports.ts `submitReport` parses through it before the insert, so a client
-- meets a Zod issue on `targetId` and never this 23514. pgTAP: 0145. No grant, policy or
-- function moves — 0121 and the `policies_are` lists are untouched.

alter table public.reports
  add constraint reports_target_required_unless_behavior
  check (target_type = 'behavior' or target_id is not null);

comment on constraint reports_target_required_unless_behavior on public.reports is
  '#611: target_id is required unless target_type = ''behavior'' — the one case 20260620011307 '
  'declared the column nullable for. One-directional: a behavior report may still name a target. '
  'Mirrored by reportInput (packages/schemas/src/report.ts); pgTAP 0145.';
