-- #511 — a cancelled Circle membership must stop saying «Si rinnova il …».
--
-- Stripe keeps a subscription `active` for the whole period the member already paid for, and
-- signals the pending end with `cancel_at_period_end = true`. The M8 cache
-- (20260618204459) stores `status` and `current_period_end` but not that flag, so the two
-- states — «renews on the 14th» and «ends on the 14th» — are indistinguishable to the app and
-- both render as a renewal. The member sees a promise of a charge that will never happen.
--
-- The column is a cache of Stripe's flag, like every other column here: written ONLY by the
-- stripe-webhook handler (service role), through the one shared `handleSubscription` upsert
-- that serves customer.subscription.created/updated/deleted. The flag is written through
-- verbatim on every one of those events, so an un-cancel (Stripe sets it back to false on the
-- same customer.subscription.updated) lands with no extra branch.
--
-- Note what the flag does NOT mean: Stripe defines it as «whether this subscription will (if
-- status=active) or did (if status=canceled) cancel at the end of the current billing period»,
-- so it stays true after the subscription actually terminates. It is therefore not a
-- «cancellation pending» flag on its own — only `status = 'active'` AND cancel_at_period_end
-- together mean «still yours until current_period_end, then gone». A canceled row fails the
-- entitlements `is_member` test anyway, so the app never reaches the renewal line for one.
--
-- `not null default false` is safe on an ALTER without a table rewrite (PG11+ stores the
-- default in the catalog), and existing rows are correct at that default: a row is only ever
-- `true` because Stripe said so, and no historical row can have been written from a payload
-- this code never read.
--
-- The `entitlements` view is deliberately NOT changed: entitlement is a question about the
-- period already paid for, and a member who cancelled keeps every benefit until
-- current_period_end. `is_member` derives from `status` and must keep doing so.
--
-- Grants: no change. The table already grants SELECT to authenticated and ALL to service_role;
-- a new column inherits the table-level grant (circle_memberships carries no column-level ACL),
-- so 0121's row for this table is unchanged.

alter table public.circle_memberships
  add column cancel_at_period_end boolean not null default false;

comment on column public.circle_memberships.cancel_at_period_end is
  'Cache of Stripe subscription.cancel_at_period_end. true = the member cancelled and access ends at current_period_end instead of renewing. Written ONLY by stripe-webhook (service role). Never a score input (rule #1).';
