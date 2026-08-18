-- Organisers acknowledge how ticket settlement works, and the server holds them to it (#437).
--
-- #104 deferred Stripe Connect past launch: no payouts, Athanor takes 0%, organisers are paid by
-- hand. That deferral was granted with conditions, and the first one — organisers must be told,
-- before they list a paid event, that settlement is manual and on what cadence — was never built.
--
-- The disclosure ships in the composer, but the composer is not where it can be enforced.
-- create_event (20260615094844:136) accepted p_price_cents and raised only 'authentication
-- required', so any authenticated caller could create a paid event; the shipped app was held back
-- by one client-side `if` at apps/native/src/app/(modal)/event-create.tsx:101. A checkbox alone is
-- decoration — whoever deletes that line deletes the disclosure's only teeth in the same edit. So
-- the refusal lives here, and the timestamp is stamped from now() server-side rather than taken
-- from the request.
--
-- Also folded in (#437 «beyond the issue»): PRD §4.13, «paid events require verified identity»,
-- was likewise enforced only at event-create.tsx:101. Checkout already fails closed
-- (create-ticket-checkout/logic.ts:118), so this was never a money hole — but it was a product rule
-- trusted to the client. It lands in the same replace rather than in a second migration fighting
-- over the same function.
--
-- DROP + CREATE, not CREATE OR REPLACE: a 14th parameter is a different argument list, which
-- Postgres treats as a new OVERLOAD rather than a replacement — two create_event functions would
-- exist and a 13-named-arg call through PostgREST would be ambiguous. Dropping discards the ACL, so
-- the revoke/grant pair is re-issued below against the new signature (the 20260814134451
-- precedent). 0121 pins both halves: anon's executable surface and PUBLIC's.

alter table public.events add column settlement_ack_at timestamptz;

comment on column public.events.settlement_ack_at is
  'When the organiser acknowledged the manual-settlement terms for THIS event (#437). Set by create_event from now() when a paid event is published with the acknowledgement ticked; null on free events. Per event, not per organiser — the 14-day promise attaches to a specific event. Never client-supplied. Not in the anon column list (20260812054134): an acknowledgement is not public event data.';

-- Grants are deliberately untouched. `authenticated` holds table-level select/insert/update on
-- public.events (20260615094844:67), so the new column needs none; `anon` holds a COLUMN LIST
-- (20260812054134:34), so the column is closed to anon by construction. Never `revoke all on table
-- public.events` here — events is one of the seven tables carrying column-level ACLs and that would
-- drop them, taking it out of 0121's count.

drop function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text);

create function public.create_event(
  p_title           text,
  p_category        public.event_category,
  p_is_online       boolean,
  p_starts_at       timestamptz,
  p_venue           text default null,
  p_city            text default null,
  p_lat             double precision default null,
  p_long            double precision default null,
  p_stream_url      text default null,
  p_ends_at         timestamptz default null,
  p_capacity        integer default null,
  p_price_cents     bigint default 0,
  p_currency        text default 'eur',
  p_settlement_ack  boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Both refusals are scoped to a paid event. A free event needs no acknowledgement, no verified
  -- identity, and leaves settlement_ack_at null — there is nothing to settle.
  if p_price_cents > 0 then
    if not p_settlement_ack then
      raise exception 'settlement acknowledgement required' using errcode = '22023';
    end if;
    -- PRD §4.13. is_identity_verified is DEFINER precisely so an invoker body can gate on the flag
    -- without the column being readable cross-RLS (20260617225450:27). Fails closed: a null uid
    -- cannot reach here, and the helper coalesces a missing row to false.
    if not public.is_identity_verified(v_uid) then
      raise exception 'identity verification required' using errcode = '42501';
    end if;
  end if;
  insert into public.events (
    organizer_id, title, category, is_online, venue, city, geo, stream_url,
    starts_at, ends_at, capacity, price_cents, currency, settlement_ack_at
  ) values (
    v_uid, p_title, p_category, p_is_online, p_venue, p_city,
    case when p_lat is not null and p_long is not null
      then extensions.st_point(p_long, p_lat)::extensions.geography
      else null end,
    p_stream_url, p_starts_at, p_ends_at, p_capacity, p_price_cents, p_currency,
    -- Server time, not the client's. The acknowledgement is evidence; a client-supplied timestamp
    -- would be evidence of nothing.
    case when p_price_cents > 0 then now() else null end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean) from public, anon;
grant  execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean) to authenticated;
