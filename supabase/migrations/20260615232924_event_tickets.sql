-- event_tickets — paid-ticket money cache (backend 04 §2.3, 08 §4.1). Stripe is the source of truth;
-- this row is written ONLY by the stripe-webhook (service role, W1). The client never inserts a ticket
-- or marks it paid — it only SELECTs its own row (which carries the QR). NEVER writes Aura (rule #1).

create table public.event_tickets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  event_id          uuid not null references public.events (id)   on delete cascade,
  stripe_payment_id text,                              -- Stripe PaymentIntent id (webhook-written)
  qr_token          text,                              -- HMAC-signed; NULL until paid (webhook-written)
  status            text not null default 'pending'
                      check (status in ('pending','paid','checked_in','refunded')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, event_id),                          -- one ticket per person per event
  unique (qr_token)                                    -- a QR token is globally unique
);

comment on table public.event_tickets is
  'Paid-ticket money cache (Stripe source of truth). Service-role-write only (stripe-webhook W1); owner reads own. Never writes Aura (rule #1).';

create index event_tickets_by_event on public.event_tickets (event_id) where status in ('paid','checked_in');

create trigger event_tickets_touch_updated_at
  before update on public.event_tickets
  for each row execute function public.touch_updated_at();

-- Deny the client at the GRANT layer (hosted default-privileges auto-grant otherwise → silent 0-row).
-- authenticated gets SELECT only (read-own, RLS-scoped); service role is the sole writer.
revoke all on table public.event_tickets from anon, authenticated;
grant select on table public.event_tickets to authenticated;
grant all on table public.event_tickets to service_role;

alter table public.event_tickets enable row level security;

-- owner reads OWN ticket only (it carries the QR — not a member-wide read).
create policy "event_tickets_select_own"
  on public.event_tickets for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- NO insert / update / delete policy for authenticated:
-- the webhook (service role) is the sole writer of paid + qr_token (08-payments-stripe §4.1).
