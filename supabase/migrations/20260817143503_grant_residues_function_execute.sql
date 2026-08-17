-- #409 — the last grant-sweep residue: EXECUTE on seven trigger-only functions.
--
-- #405/#408 swept the TABLE grant surface and left three residues named but undecided. Only one
-- of the three needed SQL; this is it. The other two were ruled on and are recorded in the PR
-- body and on the issue, because a decision that changes nothing still has to be findable:
--
--   * Policy↔grant mismatches — WITHDRAWN, the class is empty. #408's open-questions table
--     listed eleven policies with no grant behind them across six objects. Every one of the
--     eleven is an `active_write_insert`/`_update`/`_delete` policy: #106's moderation net,
--     which is RESTRICTIVE. A restrictive policy grants nothing — it can only subtract from
--     what a permissive policy already allows — so there was never a policy to drop or a grant
--     to add. The table was derived from `pg_policies` without filtering on `permissive`, the
--     same misreading that cost #405 a review cycle in the opposite direction. Re-derived
--     against the live catalog with the filter applied and column-level ACLs counted as
--     grants: zero permissive policies without a grant, schema-wide. 0121 gains the assertion
--     for that direction so the phantom cannot be re-derived by the next reader.
--
--   * service_role drift — ACCEPTED. The claim was one view; the catalog says all 59 objects.
--     `service_role` holds the full arwdDxtm set on every table and view in `public`, from the
--     `pg_default_acl` rows of BOTH grantors. #408's default-privilege fix removed
--     anon/authenticated from the row a migration can reach and kept service_role deliberately.
--     Narrowing is refused: the `supabase_admin` row is not writable from a migration, so any
--     narrowing rots on the next `create table`; service_role bypasses RLS by definition and
--     its key never leaves the edge-function environment, so a narrower ACL buys no boundary;
--     and a partial narrowing breaks a webhook or the score engine silently.
--
-- ── What this migration does ────────────────────────────────────────────────────────────
--
-- Seven functions returning `trigger` still hold EXECUTE for `public`, `anon` and
-- `authenticated`. The PUBLIC half is PostgreSQL's own default for a new function; the
-- anon/authenticated half is the `pg_default_acl` 'f' row, which #408 left alone (it fixed the
-- 'r' row only). Fifteen other trigger functions in this schema already revoke it explicitly —
-- these seven predate that habit.
--
-- Nothing here is reachable: a `trigger` return type is not callable from SQL, and the trigger
-- itself never checks EXECUTE. It is revoked for the reason 20260816083454 gives when it does
-- the same thing to its own two: a function reachable by name is a privilege surface, and the
-- standing rule for one is «revoke execute from public, anon, authenticated». An unreachable
-- privilege is still an unaudited privilege — the argument #405 was filed on.
--
-- The 'f' default ACL is deliberately NOT rewritten, though the 'r' precedent invites it.
-- Doing so would make every future client-callable RPC raise 42501 unless its migration grants
-- EXECUTE explicitly, and that failure mode is a broken screen in production, where this
-- class's failure mode is a red 0121. The default grants `anon` and `authenticated` together,
-- so 0121's new anon assertion catches a forgotten revoke on any future function anyway —
-- which is the case that actually matters.
--
-- Zero Aura (rule #1): revokes only. No data, no score, no policy.

revoke execute on function public.guard_connection_status_change() from public, anon, authenticated;
revoke execute on function public.guard_momento_status_change() from public, anon, authenticated;
revoke execute on function public.fund_contributions_edition_frozen() from public, anon, authenticated;
revoke execute on function public.fund_editions_announcement_frozen() from public, anon, authenticated;
revoke execute on function public.fund_editions_declarations_frozen() from public, anon, authenticated;
revoke execute on function public.fund_payout_ledger_within_basis() from public, anon, authenticated;
revoke execute on function public.realization_updates_binds_winner() from public, anon, authenticated;
