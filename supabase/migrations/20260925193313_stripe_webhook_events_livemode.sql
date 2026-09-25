-- #802 — record each Stripe event's mode on the idempotency ledger.
--
-- The signing secret is the only thing separating test mode from live mode, and production runs a
-- test-mode rehearsal before the live swap. Those rehearsal events write real rows into
-- production's money tables that reference objects the live account has never heard of, so the
-- ledger has to say which mode each row came from. stripe-webhook writes `event.livemode` here on
-- every delivery; RELEASE-RUNBOOK §4.2 uses it to find the rehearsal's rows at the swap.
--
-- Nullable, no default: NULL means «not recorded», never a guessed mode. Adding a nullable column
-- without a default is a catalog-only change — no table rewrite, no long lock.
--
-- The table's grants are untouched. `stripe_webhook_events` carries no column-level ACL and no
-- client privilege at all (20260615232447 revokes everything from anon and authenticated), so the
-- new column is exactly as unreachable to clients as the rest of the row; 0121's row for this
-- table stays `('stripe_webhook_events', '', '')`. The #725 redaction trigger reads and writes only
-- `payload`, and `gdpr_retention_reap()` never touches this table, so neither sees the column.

alter table public.stripe_webhook_events
  add column livemode boolean;

comment on column public.stripe_webhook_events.livemode is
  'The Stripe event''s livemode (#802): true = live, false = test mode, NULL = not recorded. Written by stripe-webhook from event.livemode; rows that predate the column were backfilled from payload. RELEASE-RUNBOOK §4.2 cleans test-mode rehearsal rows by it. Service-role only, like the rest of the ledger.';

-- Backfill from the payload every row already carries. `livemode` is not in
-- gdpr_stripe_identity_keys(), so a redacted payload still has it. The jsonb_typeof guard means a
-- row whose payload lacks a boolean `livemode` stays NULL instead of failing the cast — a
-- statement in an applied migration that can fail is unfixable afterwards.
update public.stripe_webhook_events
   set livemode = (payload ->> 'livemode')::boolean
 where livemode is null
   and jsonb_typeof(payload -> 'livemode') = 'boolean';
