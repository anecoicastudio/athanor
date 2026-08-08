-- A delayed-notification debit that never clears needs somewhere to land.
--
-- SEPA Direct Debit went live on the Stripe account. checkout.session.completed now writes
-- the contribution as 'pending' (the money has not arrived), and
-- checkout.session.async_payment_succeeded promotes it. But the failure path had no terminal
-- state: a debit that bounced stayed 'pending' forever, and payments.tsx renders 'pending' as
-- «In arrivo» — a receipt promising money that is never coming.
--
-- 'failed' is terminal and, like 'pending', is never counted by recompute_fund_aggregate
-- (which sums status = 'succeeded' only), so the public ticker is unaffected either way.
-- This only changes what the contributor is told.

alter table public.fund_contributions
  drop constraint if exists fund_contributions_status_check;

alter table public.fund_contributions
  add constraint fund_contributions_status_check
  check (status in ('pending', 'succeeded', 'refunded', 'failed'));

comment on column public.fund_contributions.status is
  'pending = authorized, money not yet settled (SEPA and other delayed methods) · succeeded = '
  'settled, counted by recompute_fund_aggregate · refunded = reversed after settling (refund or '
  'dispute) · failed = the delayed debit never cleared. Only succeeded is ever counted.';
