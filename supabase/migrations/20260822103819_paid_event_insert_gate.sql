-- A paid event is gated on the way in, on every write path — not only inside create_event (#448).
--
-- create_event refuses a paid event without the settlement acknowledgement ('22023', #437) and
-- without a verified identity ('42501', PRD §4.13), and both refusals live in the RPC
-- (20260818190348:70-80). The RPC is not the only way a row reaches this table. #446
-- (20260819041755) narrowed `authenticated` from table-level insert/update to a fourteen-column
-- INSERT list, which closed the UPDATE half outright — but `price_cents` and `settlement_ack_at`
-- HAVE to stay in that list, because create_event is SECURITY INVOKER and its own INSERT runs with
-- the caller's privileges. So a direct INSERT through PostgREST still creates a paid event with a
-- self-supplied acknowledgement and no verified identity.
--
-- A grant answers "which columns may this statement name". It cannot answer "if price_cents > 0
-- then require an acknowledgement and a verified identity" — that is a predicate over VALUES, and
-- the privilege system has no way to express one. 0125_event_settlement_ack has demonstrated the
-- residual with a deliberately passing lives_ok since #446; this migration is what turns it red,
-- and 0125's assertion is rewritten to assert the refusal rather than deleted. MIGRATIONS-ERRATA's
-- standing entry for 20260818190348 is amended in the same change.
--
-- Not a CHECK constraint: a CHECK cannot contain a subquery, so it cannot reach
-- is_identity_verified at all. It could enforce the acknowledgement arm alone — half a gate that
-- reads like a whole one.
--
-- Not a SECURITY DEFINER rewrite of create_event either, which would mean revoking INSERT on
-- events from `authenticated` entirely. 0020_events_rls proves ownership through direct INSERTs as
-- `authenticated`; those would start failing at the privilege layer instead of at the policy, and
-- a test that passes for the wrong reason is the failure .claude/rules/supabase-db.md warns about.
-- The trigger closes the invariant on every write path AND leaves the RLS layer intact.
--
-- ── BEFORE INSERT only, deliberately ─────────────────────────────────────────────────────────
-- This is creation-time. `authenticated` holds no UPDATE on events at all since #446 — the verb is
-- revoked and events_update_own is dropped — so there is no client UPDATE path for an OR UPDATE
-- arm to gate. What such an arm WOULD gate is the trusted writers: `service_role` keeps `grant
-- all`, and pg_cron runs live_window_sweep() (20260813054817) as `postgres`. Both legitimately
-- update columns that have nothing to do with the price, on rows that may predate this migration —
-- staging-seed/refresh-staging.sql:320,337 re-stamps `cena-condivisa` (1500) and `bottega-aperta`
-- (2000) hourly, and an OR UPDATE arm would make that hourly job fail on any paid row whose
-- organiser is not verified. That trades a real regression for no attacker benefit, since the
-- attacker has no UPDATE. The guard against a future re-grant is 0121's grant catalog plus 0125's
-- assertion that `authenticated` holds no UPDATE on events; if an event-edit feature ever grants
-- UPDATE back, this trigger's arm is part of what that feature has to add.

-- ── the gate ─────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default, stated by omission as elsewhere in this schema): the body reads
-- nothing under RLS. is_identity_verified is itself DEFINER with a locked search_path
-- (20260617225450:27-39), granted to `authenticated` and to `service_role`
-- (20260815164809:228) — which is exactly why an invoker body can gate on the flag without the
-- column being readable cross-RLS. A DEFINER trigger here would buy nothing and cost an audit.
create function public.enforce_paid_event_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Same errcodes, same messages, same ORDER as create_event (20260818190348:72,78). A refusal is
  -- then indistinguishable by path: whichever route produced the row, the client sees one contract
  -- and the i18n catalog needs no second mapping.
  --
  -- settlement_ack_at, not a boolean: create_event takes p_settlement_ack and stamps the timestamp
  -- from now() server-side, so on the RPC path a paid row always arrives here with the column set.
  -- On a direct INSERT the column IS the claim, and what this asserts is that a claim was made.
  -- The VALUE is still the caller's on that path — see MIGRATIONS-ERRATA; presence is what the
  -- privilege layer could never express, and presence is what this closes.
  if new.settlement_ack_at is null then
    raise exception 'settlement acknowledgement required' using errcode = '22023';
  end if;
  if not public.is_identity_verified(new.organizer_id) then
    raise exception 'identity verification required' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.enforce_paid_event_gate() is
  'Creation-time gate for paid events (#448): a row with price_cents > 0 needs settlement_ack_at set (22023, #437) and an identity-verified organiser (42501, PRD §4.13), on every write path rather than only inside create_event. The price test lives in the trigger WHEN clause, not here.';

-- 0121's #409 assertion is stated as a rule over pg_proc, not as a list, so it covers trigger
-- functions this schema does not have yet: EXECUTE on one is a privilege nobody can use and nobody
-- audits. Without this revoke the pg_default_acl 'f' row hands it to anon and authenticated and
-- 0121 goes red. Nothing to grant — a trigger function is invoked by the trigger, and PostgreSQL
-- checks EXECUTE at CREATE TRIGGER time, not at fire time.
revoke execute on function public.enforce_paid_event_gate() from public, anon, authenticated;

-- The price test is the WHEN clause and lives in exactly one place, the rsvps_enforce_capacity
-- precedent (20260812225214:186-190). A free event never fires the trigger at all, so the four
-- pgTAP fixtures that insert price_cents = 0 and every free event in the seed are untouched.
--
-- coalesce, though price_cents is `bigint not null default 0` (20260615094844:31): a WHEN clause
-- that evaluates to NULL is treated as FALSE, so a column that ever became nullable would silently
-- fail this gate open. The coalesce makes the gate independent of that, and costs one node.
create trigger events_enforce_paid_gate
  before insert on public.events
  for each row
  when (coalesce(new.price_cents, 0) > 0)
  execute function public.enforce_paid_event_gate();
