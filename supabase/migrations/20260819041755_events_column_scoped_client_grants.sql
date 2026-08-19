-- events: the client's write surface shrinks to what create_event actually writes (#446).
--
-- 20260615094844:67 granted `authenticated` table-level select, insert, update on public.events,
-- and both write policies (events_insert_own, events_update_own, :82-91) predicate on ownership
-- alone. RLS filters ROWS; it has never filtered COLUMNS. So an organiser holding a session could
-- PATCH any column of a row they own straight through PostgREST, and create_event's refusals were
-- only ever the RPC's — not the table's. What that reached:
--
--   settlement_ack_at  — #437's evidentiary record of the manual-settlement disclosure, forgeable
--                        on an existing row (0125 asserted exactly that, deliberately).
--   fee_pct            — whose own column comment says "NEVER client-tunable (PRD §4.6)".
--   is_kairos_day /    — these drive premiumLocked (apps/native/src/lib/event-row.ts:25), so an
--   is_athanor_day       organiser could put their own event behind the Circle-premium chip.
--   price_cents        — repricing a listed event, once tickets exist.
--
-- Grants, not a policy, because the distinction IS the bug: a WITH CHECK can only say which rows
-- may exist, never which columns a statement may name. The narrowing has to happen on the
-- privilege axis or it does not happen at all. This is the `profiles` pattern (20260617225450:16-23)
-- that keeps founding_member and identity_verified unwritable by their owner.
--
-- Named verbs only. NEVER `revoke all on table public.events` — events is one of the seven tables
-- carrying column-level ACLs (anon's published-column SELECT list, 20260812054134), and `revoke
-- all` drops attacl too, taking the table out of 0121's count of seven and silently re-opening
-- stream_url / fee_pct / capacity to the internet.

-- ── UPDATE goes to zero, not to a column list ────────────────────────────────────────────────
-- No application code updates events. Every `.from('events')` in apps/native, apps/web,
-- packages/api and supabase/functions is a `.select()`; creation goes through the create_event
-- RPC. There is no event edit screen, no cancel, no cover upload. The live window is swept
-- server-side by live_window_sweep() (20260813054817), which is invoker but cron-only — pg_cron
-- runs it as `postgres`, and it is revoked from anon/authenticated. Erasure is the service-role
-- GDPR job. 20260812225214:40 already assumed this: claim_event_seat went SECURITY DEFINER partly
-- because "FOR UPDATE on events would require an UPDATE policy the caller fails".
--
-- So a column list here would enumerate an empty purpose, and an empty-purpose grant is worse than
-- no grant: it reads as a decision someone made rather than a surface nobody uses. When an edit
-- feature lands it grants its own list, reviewed against what that feature writes.
revoke update on table public.events from authenticated;

-- The policy goes with the privilege. A PERMISSIVE client policy with no grant behind it is a
-- vestige, and 0121's #409 assertion fails on exactly that — it reads pg_policies for permissive
-- client policies and requires a table or column grant for each. Dropping the last permissive
-- UPDATE policy also leaves #106's restrictive `active_write_update` structurally orphaned on this
-- table: harmless, because RLS denies a verb outright when no permissive policy allows it, and a
-- restrictive policy can only subtract. It stays for uniformity with the moderation net's
-- per-table loop (20260813045347:82-107) and because a future edit feature will want it back.
drop policy "events_update_own" on public.events;

-- ── INSERT is scoped to exactly the columns create_event writes ──────────────────────────────
-- create_event is SECURITY INVOKER (20260818190348:58), so its INSERT runs with the caller's
-- privileges: the list below is not a guess at what a client needs, it is the RPC's own column
-- list. Anything outside it is server-set — a default, a trigger, or a later service-role write.
--
-- Excluded and why: id (gen_random_uuid), fee_pct (server config, PRD §4.6), is_kairos_day and
-- is_athanor_day (they gate the Circle-premium chip), cover_url (no upload path exists yet),
-- live_started_at / live_ended_at (live_window_sweep's, above), created_at / updated_at (defaults
-- and the touch trigger — a BEFORE UPDATE trigger assigns NEW.updated_at inside the function, so
-- the caller never needs the column privilege), deleted_at (soft-delete is service-role).
revoke insert on table public.events from authenticated;
grant insert (organizer_id, title, category, is_online, venue, city, geo, stream_url,
              starts_at, ends_at, capacity, price_cents, currency, settlement_ack_at)
  on table public.events to authenticated;

-- ── What this does NOT close ─────────────────────────────────────────────────────────────────
-- price_cents and settlement_ack_at have to stay in the list above, because create_event writes
-- them and is invoker. So a direct INSERT can still create a paid event with a self-supplied
-- settlement_ack_at and no verified identity, skipping both of create_event's refusals. Grants
-- cannot express "price_cents > 0 requires X" — that needs a validating trigger or a DEFINER
-- rewrite, and both are decisions of their own. No money follows the residual:
-- create-ticket-checkout/logic.ts:125 re-derives is_identity_verified(event.organizer_id) and
-- fails closed. 0125's last assertion keeps demonstrating it rather than pretending it is gone.

-- authenticated keeps TABLE-LEVEL SELECT. The organiser legitimately reads fee_pct and capacity
-- on their own event — that is what 20260812054134's closing comment promises, and it is why the
-- anon narrowing was scoped to anon in the first place.
