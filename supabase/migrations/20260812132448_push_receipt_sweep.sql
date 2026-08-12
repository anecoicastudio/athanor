-- Push receipt sweep (#128): give push-dispatch somewhere to remember the tickets it sends,
-- and an hourly cron that reads Expo's receipts for them and prunes dead tokens.
--
-- WHY a table at all: Expo's receipts are NOT available at send time. sendPushNotificationsAsync
-- returns a ticket carrying a receipt id; the receipt itself (which is where a delivery-time
-- DeviceNotRegistered shows up) appears minutes later and lives on Expo's side for roughly a day.
-- Edge functions keep no state between invocations, so the receipt id has to be durable or the
-- second pass has nothing to ask about.
--
-- NOT a domain table: no client ever reads or writes it, so it follows the
-- stripe_webhook_events shape — privileges revoked from anon/authenticated (a client write is
-- 42501, not a silent RLS 0-row), RLS on with no client policies, service_role only. It gets no
-- packages/schemas mirror for the same reason the push_tokens row model was deleted in #272: a
-- schema nothing imports is dead code. The generated database.types.ts covers it.

create table public.push_receipts (
  id uuid primary key default gen_random_uuid(),
  -- Expo's ExpoPushReceiptId from the success ticket. Unique: one row per ticket, and the
  -- constraint makes a retried send idempotent rather than duplicating the lookup.
  receipt_id text not null unique,
  -- The token this ticket was sent to — the thing we delete when the receipt says
  -- DeviceNotRegistered. Denormalized on purpose: no FK to push_tokens, because the row must
  -- survive the token being re-registered or deleted between send and sweep.
  token text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_receipts is
  'Expo push ticket ids awaiting a receipt (#128). Written by push-dispatch on send, drained by its hourly sweep mode. Service-role only; no client reads or writes.';

create trigger push_receipts_touch_updated_at
  before update on public.push_receipts
  for each row execute function public.touch_updated_at();

-- The sweep's only access path: oldest-first among rows old enough to have a receipt.
create index push_receipts_created_at_idx on public.push_receipts (created_at);

revoke all on table public.push_receipts from anon, authenticated;
grant all on table public.push_receipts to service_role;

alter table public.push_receipts enable row level security;
-- no client policies: service role only (same posture as stripe_webhook_events).

-- ── hourly sweep cron ────────────────────────────────────────────────────────
-- Reuses push-dispatch rather than adding a second edge function: same Expo access token, same
-- service-role posture, one more `mode` on a body the function already parses. Guarded the same
-- way as every other pg_net caller — a no-op until the Vault secrets are set, so the job never
-- errors pre-deploy (see 20260810103721_pg_net_config_via_vault.sql for why Vault, not a GUC).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_push_receipt_sweep() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('push_dispatch_url');
  v_key text := athanor.runtime_setting('push_dispatch_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- push not configured (pre-deploy) → no-op
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: an sb_secret_… key
    -- is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('mode', 'sweep'),
    timeout_milliseconds := 5000
  );
end;
$$;

comment on function public.invoke_push_receipt_sweep() is
  'Hourly: asks push-dispatch to read Expo receipts for pending tickets and prune DeviceNotRegistered tokens (#128).';

revoke execute on function public.invoke_push_receipt_sweep() from public, anon, authenticated;

-- Hourly, not nightly: Expo keeps a receipt for about a day, so an hourly cadence leaves ~24
-- attempts before one expires unread. :23 stays clear of the nightly jobs at :17.
select cron.schedule(
  'push-receipt-sweep',
  '23 * * * *',
  $$ select public.invoke_push_receipt_sweep() $$
);
