-- #841 — purge the dormant `comms` consent kind.
--
-- PR 840 (#783) removed the «Comunicazioni e novità» switch: no marketing mail exists to gate.
-- The kind stayed stored and in consent_kind_check, so every `comms` row became personal data
-- nothing reads and nothing in the UI can change. This deletes those rows and narrows the CHECK
-- to the two kinds a current build writes.
--
-- Old builds. The Play build submitted 2026-09-21 predates PR 840 and still carries the switch,
-- which upserts `kind = 'comms'`. A narrowed CHECK alone would reject that write (23514), and
-- that build's onError rolls back and toasts on every tap. So a BEFORE INSERT trigger discards
-- a `comms` row first: the old build's upsert succeeds with nothing written, the CHECK never
-- sees the row, and no `comms` row accumulates again. PostgREST's upsert is INSERT … ON
-- CONFLICT, and a BEFORE INSERT row trigger returning NULL skips the row before the conflict
-- arbiter runs, so the upsert path is covered too. The trigger and its function can be dropped
-- once no installed build carries the switch.
--
-- Order: trigger first, so the SHARE ROW EXCLUSIVE lock it takes holds off a concurrent insert
-- until commit; then the delete; then the constraint swap, which validates against the purged
-- table. All in the migration's one transaction.
--
-- Supersedes the header of 20260620122139_m9_consent.sql («Kinds: comms …», «rows persist as an
-- audit trail») — see MIGRATIONS-ERRATA.md. Asserted by pgTAP 0056.

create function athanor.consent_discard_retired_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'comms' then
    return null; -- retired (#841): an old build's switch writes it; keep nothing
  end if;
  return new;
end; $$;
revoke execute on function athanor.consent_discard_retired_kind() from public, anon, authenticated;

create trigger consent_discard_retired_kind
  before insert on public.consent
  for each row execute function athanor.consent_discard_retired_kind();

delete from public.consent where kind = 'comms';

alter table public.consent drop constraint consent_kind_check;
alter table public.consent
  add constraint consent_kind_check check (kind in ('analytics', 'location_approx'));

comment on table public.consent is
  'GDPR consent records (analytics/location_approx). Owner CRUD own (minus delete). One row per (profile_id, kind), upserted: a change overwrites granted/granted_at, no history is kept. `comms` is retired (#841): a BEFORE INSERT trigger discards it. The "data never sold" guarantee is constitutional — it has NO row (not a toggle).';
