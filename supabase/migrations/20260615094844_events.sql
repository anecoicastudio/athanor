-- events — Athanor Live (PRD §4.6 / frontend 04 §3, backend 04 §2.1). The one
-- PUBLIC-readable table this milestone: anon may SELECT published events for SEO
-- and browsing; writes stay authenticated-owner-only. PostGIS-located (approximate,
-- PRD §4.2). Published = deleted_at is null (no draft state in M4). Creating /
-- attending an event are M6-scored actions — this migration NEVER writes aura
-- (rule #1) and NEVER touches money (event_tickets is the tickets-qr slice).

-- PostGIS into the dedicated extensions schema (Supabase convention; never public).
create extension if not exists postgis with schema extensions;

-- Category enum — mirrors PRD §4.6 + the prototype's extra chips. One enum, shared by
-- Live filters, event rows, and the create form. @athanor/schemas mirrors it.
create type public.event_category as enum (
  'business', 'networking', 'spiritualita', 'formazione',
  'musica', 'arte', 'benessere', 'creativi', 'evoluzione'
);

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  organizer_id    uuid not null references public.profiles (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 1 and 140),
  category        public.event_category not null,
  is_online       boolean not null default false,
  venue           text check (venue is null or char_length(venue) <= 240),
  city            text check (city is null or char_length(city) <= 120),
  geo             extensions.geography(Point, 4326),
  stream_url      text check (stream_url is null or stream_url ~ '^https?://'),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  capacity        integer check (capacity is null or capacity > 0),
  price_cents     bigint not null default 0 check (price_cents >= 0),
  currency        text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  fee_pct         numeric(5,2) not null default 10.00 check (fee_pct between 0 and 100),
  is_kairos_day   boolean not null default false,
  is_athanor_day  boolean not null default false,
  cover_url       text,
  live_started_at timestamptz,
  live_ended_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint events_online_or_physical check (
    (is_online and stream_url is not null)
    or (not is_online and geo is not null)
  ),
  constraint events_ends_after_starts check (ends_at is null or ends_at > starts_at),
  constraint events_live_window check (live_ended_at is null or live_started_at is not null)
);

comment on table public.events is
  'Athanor Live events (PRD §4.6). Public-readable when published (deleted_at is null). Owner-write. Money (event_tickets) and Aura (M6 engine) are NEVER written here.';
comment on column public.events.geo is 'Approximate location, geography(Point,4326). NULL for online events. Set server-side via create_event(lat,long).';
comment on column public.events.fee_pct is 'Platform fee % — server-config (default 10), NEVER client-tunable (PRD §4.6).';
comment on column public.events.price_cents is 'Ticket price minor units. 0 = free. Set at create; money flows via Stripe (tickets-qr slice).';

create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

create index events_calendar    on public.events (starts_at, id) where deleted_at is null;
create index events_geo_gist     on public.events using gist (geo) where deleted_at is null;
create index events_by_organizer on public.events (organizer_id, starts_at desc) where deleted_at is null;
create index events_online       on public.events (starts_at) where is_online and deleted_at is null;

revoke all on table public.events from anon;
grant select on table public.events to anon;
grant select, insert, update on table public.events to authenticated;
grant all on table public.events to service_role;

alter table public.events enable row level security;

create policy "events_select_anon"
  on public.events for select
  to anon
  using (deleted_at is null);

create policy "events_select_authenticated"
  on public.events for select
  to authenticated
  using (deleted_at is null);

create policy "events_insert_own"
  on public.events for insert
  to authenticated
  with check ((select auth.uid()) = organizer_id);

create policy "events_update_own"
  on public.events for update
  to authenticated
  using ((select auth.uid()) = organizer_id)
  with check ((select auth.uid()) = organizer_id);

-- no delete policy: erasure goes through the GDPR job (service role, M9)

create function public.events_nearby(
  lat         double precision,
  long        double precision,
  radius_m    double precision default 50000,
  cursor_dist double precision default null,
  cursor_id   uuid default null,
  page_size   integer default 20
)
returns table (
  id          uuid,
  title       text,
  category    public.event_category,
  starts_at   timestamptz,
  venue       text,
  city        text,
  dist_meters double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id, e.title, e.category, e.starts_at, e.venue, e.city,
    extensions.st_distance(e.geo, extensions.st_point(long, lat)::extensions.geography) as dist_meters
  from public.events e
  where e.deleted_at is null
    and e.is_online = false
    and e.geo is not null
    and extensions.st_dwithin(e.geo, extensions.st_point(long, lat)::extensions.geography, radius_m)
    and (
      cursor_dist is null
      or (extensions.st_distance(e.geo, extensions.st_point(long, lat)::extensions.geography), e.id) > (cursor_dist, cursor_id)
    )
  order by e.geo operator(extensions.<->) extensions.st_point(long, lat)::extensions.geography, e.id
  limit page_size;
$$;

revoke execute on function public.events_nearby(double precision, double precision, double precision, double precision, uuid, integer) from public;
grant  execute on function public.events_nearby(double precision, double precision, double precision, double precision, uuid, integer) to anon, authenticated;

create function public.create_event(
  p_title       text,
  p_category    public.event_category,
  p_is_online   boolean,
  p_starts_at   timestamptz,
  p_venue       text default null,
  p_city        text default null,
  p_lat         double precision default null,
  p_long        double precision default null,
  p_stream_url  text default null,
  p_ends_at     timestamptz default null,
  p_capacity    integer default null,
  p_price_cents bigint default 0,
  p_currency    text default 'eur'
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
  insert into public.events (
    organizer_id, title, category, is_online, venue, city, geo, stream_url,
    starts_at, ends_at, capacity, price_cents, currency
  ) values (
    v_uid, p_title, p_category, p_is_online, p_venue, p_city,
    case when p_lat is not null and p_long is not null
      then extensions.st_point(p_long, p_lat)::extensions.geography
      else null end,
    p_stream_url, p_starts_at, p_ends_at, p_capacity, p_price_cents, p_currency
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text) from public, anon;
grant  execute on function public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text) to authenticated;
