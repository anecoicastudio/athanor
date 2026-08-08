-- 'failed' leaves the fund_contributions vocabulary along with SEPA.
--
-- 20260808075738 added it as the terminal state for a delayed-notification debit that never
-- cleared. Delayed-notification methods are no longer accepted: SEPA Direct Debit comes off
-- the Stripe payment-method configuration, the checkout.session.async_payment_* state machine
-- is deleted, and handleTicketPaid / handleContribution now THROW on any session whose
-- payment_status is not final (stripe-webhook/handlers.ts, assertSettled). Nothing can write
-- 'failed' again, and a status the code cannot produce should not sit in the CHECK
-- advertising itself.
--
-- Two corrections to 20260808075738's prose — unfixable in place under rule #7 — are recorded
-- in supabase/MIGRATIONS-ERRATA.md. In short: SEPA did not stay live, and PayPal is not a
-- delayed-notification method (Stripe permits only synchronous funding sources on PayPal
-- unless you ask Support to enable asynchronous ones, so it reports its outcome on
-- checkout.session.completed exactly as a card does). PayPal stays enabled; SEPA does not.
--
-- Any row still at 'failed' is a debit that never settled. recompute_fund_aggregate sums
-- status = 'succeeded' alone, so it was never counted and the public ticker is unaffected.
-- It retires to 'refunded' — the pre-existing terminal "this money is not here" state —
-- rather than being deleted, so the contributor keeps a receipt and the
-- stripe_checkout_session_id stays unique-claimed against a webhook redelivery. Retiring it
-- to 'pending' would restore the bug 3177380 fixed: a receipt promising «In arrivo» forever.
-- The remap runs under the OLD constraint, before the swap, so ordering cannot deadlock.
--
-- 'pending' is NOT removed. It predates SEPA (20260618153032) and it is the column DEFAULT —
-- dropping it from the CHECK would make every insert that omits status fail with 23514.

update public.fund_contributions
   set status = 'refunded'
 where status = 'failed';

alter table public.fund_contributions
  drop constraint if exists fund_contributions_status_check;

alter table public.fund_contributions
  add constraint fund_contributions_status_check
  check (status in ('pending', 'succeeded', 'refunded'));

comment on column public.fund_contributions.status is
  'pending = the column default; never written by the webhook, because every enabled payment '
  'method reports its outcome on checkout.session.completed · succeeded = settled, the only '
  'status recompute_fund_aggregate counts · refunded = reversed after settling (refund or '
  'dispute). Delayed-settlement methods are not accepted — see assertSettled in '
  'supabase/functions/stripe-webhook/handlers.ts.';
