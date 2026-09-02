-- #634 item 3: every event detail rendered the same fabricated sentence (`event.descFallback`)
-- for every event, under the organizer's name, because events had no description column and
-- event-create no field. This adds the column the organizer's own words live in; the app
-- renders it when present and nothing otherwise — an absent paragraph asserts nothing.
--
-- events carries COLUMN-scoped client ACLs (#446), so the new column must be granted by name
-- in this same migration or it is born unreachable: create_event is SECURITY INVOKER (its
-- INSERT runs with the caller's privileges) and the public event page reads as anon.

alter table public.events
  add column description text
    constraint events_description_len
      check (description is null or char_length(description) <= 2000);

comment on column public.events.description is
  'Organizer-written description, shown on the event detail (native + public web). Nullable: an absent paragraph asserts nothing (#634).';

-- Column grants — #446 revoked table-level INSERT and anon SELECT in favour of named columns.
grant insert (description) on public.events to authenticated;
grant select (description) on public.events to anon;

-- create_event grows one trailing defaulted parameter. That is a NEW signature: recreate,
-- re-point the execute grants at the 15-arg function, and drop the 14-arg one so PostgREST's
-- schema cache resolves exactly one overload. Positional callers survive — the new parameter
-- is last and defaulted.
drop function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean);

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
  p_settlement_ack  boolean default false,
  p_description     text default null
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
    starts_at, ends_at, capacity, price_cents, currency, settlement_ack_at, description
  ) values (
    v_uid, p_title, p_category, p_is_online, p_venue, p_city,
    case when p_lat is not null and p_long is not null
      then extensions.st_point(p_long, p_lat)::extensions.geography
      else null end,
    p_stream_url, p_starts_at, p_ends_at, p_capacity, p_price_cents, p_currency,
    -- Server time, not the client's. The acknowledgement is evidence; a client-supplied timestamp
    -- would be evidence of nothing.
    case when p_price_cents > 0 then now() else null end,
    p_description
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean, text) from public, anon;
grant  execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean, text) to authenticated;
