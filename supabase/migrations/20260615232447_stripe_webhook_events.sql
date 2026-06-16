-- stripe_webhook_events — shared idempotency ledger for every Stripe webhook (backend 00 §7, 08 §4.1).
-- Service-role only: the handler upserts on event_id before processing, branches on processed_at.
-- NOT a domain table; clients never read or write it.

create table public.stripe_webhook_events (
  event_id     text primary key,                 -- Stripe event id = dedupe key
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.stripe_webhook_events is
  'Idempotency ledger — every webhook upserts on event_id before processing (backend 00 §7). Service-role only.';

-- service role only (bypasses RLS); deny the client at the GRANT layer so a client write is 42501,
-- not a silent RLS 0-row (hosted default-privileges auto-grant otherwise).
revoke all on table public.stripe_webhook_events from anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

alter table public.stripe_webhook_events enable row level security;
-- no client policies: service role only.
