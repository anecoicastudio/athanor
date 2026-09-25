-- #802 review — `stripe_webhook_events.livemode` becomes a STORED GENERATED column over `payload`.
--
-- 20260925193313 added it as a plain column that stripe-webhook would write, plus a one-shot
-- backfill. That shape had two holes, both closed by deriving the value instead of copying it:
--
--   1. Rows written between that migration and the #802 function deploy came from a function that
--      did not write the column, so they stayed NULL forever — `ignoreDuplicates` means no later
--      delivery corrects them — and RELEASE-RUNBOOK §4.2's cleanup inventory, which reads
--      `livemode = false`, would miss exactly those rehearsal rows.
--   2. A function that writes a column the table lacks is rejected by PostgREST, so deploying the
--      function before the migration would 500 «ledger error» on every delivery. With the value
--      generated, stripe-webhook writes nothing new and the two can land in either order.
--
-- `payload` already carries the event's `livemode`, and `livemode` is not in
-- gdpr_stripe_identity_keys(), so neither the #725 BEFORE INSERT redaction trigger nor
-- gdpr_erase_payment_footprint changes it; a stored generated column is computed after BEFORE
-- triggers and recomputed on every UPDATE of `payload`, so it can never disagree with the row.
-- NULL still means «the payload carries no boolean livemode», never a guess.
--
-- PostgreSQL cannot turn an existing column into a generated one, so it is dropped and re-added.
-- The drop loses nothing: every value it held was either copied from `payload` or NULL. Adding a
-- stored generated column rewrites the table, which on this ledger is a small, service-role-only
-- table with no client traffic.
--
-- Grants are untouched, as in 20260925193313: the table carries no column-level ACL and no client
-- privilege at all, and 0121's row for it stays `('stripe_webhook_events', '', '')`.

alter table public.stripe_webhook_events
  drop column livemode;

alter table public.stripe_webhook_events
  add column livemode boolean
  generated always as (
    case when jsonb_typeof(payload -> 'livemode') = 'boolean'
         then (payload ->> 'livemode')::boolean
    end
  ) stored;

comment on column public.stripe_webhook_events.livemode is
  'The Stripe event''s livemode (#802), generated from payload: true = live, false = test mode, NULL = the payload carries no boolean livemode. Never written directly. RELEASE-RUNBOOK §4.2 finds test-mode rehearsal rows by it. Service-role only, like the rest of the ledger.';
