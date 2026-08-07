-- Webhook claim lease (audit follow-up, 00 §7 / 08 §4.1).
-- The atomic claim previously stamped processed_at BEFORE processing; an isolate
-- hard-crash inside processEvent left a stale "processed" row and Stripe's
-- retries acked 200 — at-most-once under crash. claimed_at separates "in flight"
-- (lease, reclaimable after expiry) from "done" (processed_at): the edge claim
-- becomes UPDATE ... SET claimed_at = now() WHERE processed_at IS NULL AND
-- (claimed_at IS NULL OR claimed_at < now() - lease) RETURNING, restoring
-- at-least-once with per-handler UNIQUE-constraint idempotency absorbing replays.
-- Service-role only table — RLS enabled with zero policies (pgTAP 0024/0071).

alter table public.stripe_webhook_events
  add column claimed_at timestamptz;

comment on column public.stripe_webhook_events.claimed_at is
  'In-flight processing lease. NULL = unclaimed; stale (older than the edge LEASE_MS) = reclaimable. processed_at remains the completion marker.';
