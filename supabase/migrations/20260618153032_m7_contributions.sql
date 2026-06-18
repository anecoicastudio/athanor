-- M7 contributions: one-off Stripe Checkout contributions to the annual Dream Fund.
-- SRW (service-role-write-only): written ONLY by the stripe-webhook edge fn (W3/W4).
-- Money is a cache of Stripe webhooks (rule #6). Contributions award ZERO Aura (rule #1).

create table public.fund_contributions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.fund_editions (id) on delete restrict,
  profile_id uuid references public.profiles (id) on delete set null, -- nullable: anonymous contributions allowed
  amount_cents bigint not null check (amount_cents >= 100),           -- min €1 (PRD §4.11)
  currency text not null default 'eur' check (currency = lower(currency)),
  stripe_checkout_session_id text not null unique,                    -- row-level idempotency
  stripe_payment_intent_id text unique,
  status text not null default 'pending'
    check (status in ('pending','succeeded','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fund_contributions is
  'Cache of Stripe Checkout contributions. Written ONLY by stripe-webhook (service role). Member reads own. Zero Aura (rule #1). Money = webhook cache (rule #6).';

create index fund_contributions_edition_succeeded
  on public.fund_contributions (edition_id) where status = 'succeeded';
create index fund_contributions_profile_feed
  on public.fund_contributions (profile_id, created_at desc, id desc);   -- cursor (own history), never offset

create trigger fund_contributions_touch_updated_at
  before update on public.fund_contributions
  for each row execute function public.touch_updated_at();

-- SRW: owner reads own; nobody but service_role writes. Grant deliberately omits insert/update/delete
-- so a client write is permission-denied (42501), not just RLS-filtered to zero rows.
revoke all on table public.fund_contributions from anon;
grant select on table public.fund_contributions to authenticated;
grant all on table public.fund_contributions to service_role;

alter table public.fund_contributions enable row level security;

create policy "fund_contributions_select_own"
  on public.fund_contributions for select
  to authenticated
  using ((select auth.uid()) = profile_id);
-- NO insert/update/delete client policy. The webhook writes as service_role (bypasses RLS).

-- Recompute the live-ticker aggregate from source (succeeded contributions only). Idempotent:
-- the webhook calls this after each W3/W4 write, so a redelivery re-derives the same totals.
-- SECURITY DEFINER + locked search_path; execute revoked from clients (service_role only).
create or replace function public.recompute_fund_aggregate(p_edition_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fund_aggregates (edition_id, raised_cents, contributor_count, updated_at)
  select p_edition_id,
         coalesce(sum(amount_cents), 0),
         count(distinct profile_id),   -- distinct contributors; anon (null profile_id) excluded (MVP)
         now()
  from public.fund_contributions
  where edition_id = p_edition_id and status = 'succeeded'
  on conflict (edition_id) do update
    set raised_cents = excluded.raised_cents,
        contributor_count = excluded.contributor_count,
        updated_at = now();
$$;

comment on function public.recompute_fund_aggregate(uuid) is
  'Recompute fund_aggregates from succeeded fund_contributions (rule #6 webhook cache). Service-role only.';

revoke all on function public.recompute_fund_aggregate(uuid) from public, anon, authenticated;
grant execute on function public.recompute_fund_aggregate(uuid) to service_role;
