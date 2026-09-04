-- #245 — payout_accounts: the Connect Express account cache for the payout rail (#214).
-- Ruling #244 (issue comment, 2026-08-15): Connect Express (Stripe carries KYC), separate
-- charges and transfers with funds resting in Athanor's balance, one connected account per
-- cycle winner. Shape per docs/superpowers/specs/2026-08-08-p2p-dream-fund-design.md
-- ("Data model" · payout_accounts): one per profile — stripe_account_id (unique),
-- charges_enabled, payouts_enabled, onboarded_at.
--
-- Rule #6: this table is a CACHE of Stripe account state — Stripe is the source of truth.
-- Written ONLY by the stripe-webhook `account.updated` branch (service role). #246 mints the
-- onboarding link (create-payout-onboarding); #247 reads the capability flags before any
-- transfer, so both default false — a transfer gate that fails closed until Stripe says
-- otherwise. Zero Aura anywhere in this file (rule #1): nothing here may feed the score
-- engine, and pgTAP 0111 asserts it.

create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  -- One row per profile (design doc). CASCADE, not the money-table restrict: this row is a
  -- pointer cache, not money history — on a hard erasure it must vanish with the profile
  -- rather than block it (the Stripe account itself outlives us either way).
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  stripe_account_id text not null unique,   -- acct_… — the webhook's lookup key
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  onboarded_at timestamptz,                 -- null until onboarding completes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payout_accounts is
  '#245/#244: cache of Stripe Connect Express account state. Written ONLY by stripe-webhook account.updated (service role). Owner reads own. Stripe is the source of truth (rule #6). Zero Aura (rule #1). Not user content — no deleted_at.';

create trigger payout_accounts_touch_updated_at
  before update on public.payout_accounts
  for each row execute function public.touch_updated_at();

-- SRW posture (the fund_contributions / circle_memberships / screening_criteria pattern):
-- hosted ALTER DEFAULT PRIVILEGES auto-grants client writes on new public tables, so a
-- blocked client write would silently affect 0 rows instead of raising 42501. Strip
-- everything, grant back exactly owner-scoped SELECT.
revoke all on table public.payout_accounts from anon, authenticated;
grant select on table public.payout_accounts to authenticated;
grant all on table public.payout_accounts to service_role;

alter table public.payout_accounts enable row level security;

create policy "payout_accounts_select_own"
  on public.payout_accounts for select
  to authenticated
  using ((select auth.uid()) = profile_id);
-- NO insert/update/delete client policy. The webhook writes as service_role (bypasses RLS).
