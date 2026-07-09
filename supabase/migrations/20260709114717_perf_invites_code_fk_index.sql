-- perf(supabase): covering index for unindexed FK invites_code_fkey
--
-- Source: Supabase performance advisor (`get_advisors(type: performance)`,
-- project kwzeiqvrnnaagccyoose, 2026-07-09) — "unindexed_foreign_keys" (INFO).
-- invites.code references profiles(referral_code); without a covering index every
-- parent-row UPDATE/DELETE RI-check and every join/filter on code seq-scans invites.
-- Same pattern as 20260701160202_fk_covering_indexes.sql.
--
-- Index-only — no table shape change, so `pnpm gen:types` is a no-op.

create index if not exists invites_code_idx
  on public.invites (code);
