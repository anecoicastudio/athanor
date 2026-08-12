-- Close the anon column-leak on public.events (issue #159, athanor-reviewer blocker).
--
-- 20260615094844_events.sql granted anon SELECT on the WHOLE row. RLS filters rows, never
-- columns, so anyone holding the publishable key could ask PostgREST directly for
-- `?select=stream_url,fee_pct` and read them for every published event — bypassing the
-- @athanor/api read-model entirely. Same bug, same fix as
-- 20260614153620_restrict_anon_profile_columns.sql did for profiles.
--
-- It mattered little while event ids were hard to enumerate. The public /event/{id} page
-- lists every upcoming event id in sitemap.xml, hourly, for crawlers — so the ids are now
-- a published set and the grant is what stands between them and the columns.
--
-- Revoked from anon:
--   stream_url  the link to a PAID online event. A public read is the ticket bypassed.
--   fee_pct     platform fee — server config, never client-tunable (PRD §4.6).
--   capacity    only meaningful beside an attendee count anon cannot read; least privilege.
--
-- Deliberately still granted to anon:
--   geo         public.events_nearby() is SECURITY INVOKER and granted to anon, so it needs
--               the column privilege to compute st_distance for an anonymous caller. The
--               point is already approximate by construction (PRD §4.2) and the RPC returns
--               a distance, never the point. The public read-model still never selects it;
--               that is a narrower promise than this grant, and the code says so.
--   organizer_id  the public page resolves the organizer's @handle through it, and
--               profiles RLS decides on its own whether that handle is public.
--   deleted_at  every anon query filters `deleted_at is null`, and PostgREST needs the
--               privilege on a column to filter by it.
--
-- authenticated keeps the full row: members see the stream link they paid for, and the
-- organizer's own screens read fee_pct and capacity.

revoke select on table public.events from anon;

grant select (
  id,
  organizer_id,
  title,
  category,
  is_online,
  venue,
  city,
  geo,
  starts_at,
  ends_at,
  price_cents,
  currency,
  is_kairos_day,
  is_athanor_day,
  cover_url,
  live_started_at,
  live_ended_at,
  created_at,
  updated_at,
  deleted_at
) on table public.events to anon;

comment on column public.events.stream_url is
  'Link to the online event. NOT granted to anon (20260812054134): a public read bypasses the ticket for a paid stream. Members read it through the authenticated grant.';
