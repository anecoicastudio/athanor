-- #781 — an event's point is approximate by construction, and signed-out callers never see it.
-- Ruling 2026-09-19 (Marco): fixed in code, not declared precise.
--
-- Until now the organiser's device fix was stored as it arrived. On Android that fix was
-- PRIORITY_BALANCED_POWER_ACCURACY (expo-location's `Accuracy.Low` — Google's "block level"),
-- `anon` held SELECT on the column, and `events_nearby()` returned the exact distance to it for any
-- origin a caller chose — so three anonymous calls placed the organiser's phone. Two Play
-- declarations were false while that held: Content rating's "does not share precise location with
-- other users", and Data safety's "approximate location only".
--
-- ── 1. the grid, on the table ─────────────────────────────────────────────────────────────────
-- Every write to `geo` is snapped to a 0.025° lattice — forty cells per degree. Play's Data safety
-- form calls a location approximate when it resolves an area of at least 3 km² (Play Console Help,
-- answer 10787469). Measured with st_area on the WGS84 spheroid, one 0.025° cell is 5.28 km² at
-- Italy's northernmost point (47.09°N), 5.43 km² at Milan and 6.29 km² at Lampedusa (35.5°N);
-- cells narrow with cos(latitude), so the northern edge is the binding one, and the bar still
-- holds at Stockholm (3.96 km²) and fails only near 67°N. A 0.02° grid clears Italy (3.38 km² at
-- 47.09°N) but is down to 3.02 km² at Berlin (52.52°N) and under the bar just north of it, which
-- is why the margin was bought.
--
-- A trigger rather than a new `create_event` body, because `create_event` is not the only writer:
-- `events_insert_own` still admits a direct PostgREST INSERT and 20260819041755 grants
-- `authenticated` INSERT on `geo`, so a rounding that lived in the RPC would be a convention the
-- direct path could ignore — the same hole #448 closed for the paid gate. `create_event` is
-- SECURITY INVOKER, so its INSERT fires this trigger too, as do the staging seed, the service role
-- and every pgTAP fixture. UPDATE OF geo is covered for the service role and for the backfill
-- below; the client has held no UPDATE on `events` since #446.
--
-- The arithmetic is `floor(x * 40 + 0.5) / 40`, never `round()`: Postgres rounds a float8 tie to
-- even and `@athanor/core`'s `snapToEventGrid` breaks it upward, and the app snaps BEFORE the
-- point leaves the phone. Spelled identically, a point the app already snapped is left where it
-- is. `packages/core/src/events/geo-grid.mirror.test.ts` reads this file and fails if the literal
-- here and EVENT_GEO_CELLS_PER_DEGREE drift.
--
-- ── 2. anon loses the column, and with it events_nearby ───────────────────────────────────────
-- 20260812054134 kept `geo` granted to anon on purpose: `events_nearby()` is SECURITY INVOKER and
-- was granted to anon, so an anonymous caller needed the column to compute st_distance. Revoking
-- the column alone would turn every anonymous call into a 42501. Nothing anonymous calls it: the
-- only caller is `packages/api/src/events.ts`' `getEventsNearby`, reached only from «Vicino»
-- (`VicinoPanel.tsx`, inside the `(modal)/live` route), which AuthGuard redirects a signed-out
-- visitor away from; `apps/web` has no caller. So anon loses EXECUTE on the function as well, and
-- the function's own grant is what says so rather than a 42501 at the column.
--
-- Realtime is covered by the same revoke: `realtime.apply_rls` filters each change's columns by
-- `has_column_privilege(<subscriber role>, …, 'SELECT')`, so `public.events` staying in the
-- `supabase_realtime` publication does not re-open the column to an anonymous subscriber.
--
-- `authenticated` keeps `geo`: the signed-in «Vicino» runs `events_nearby()` as the member, and the
-- organiser's INSERT writes it. What a member can read is the grid point — the whole reason for §1.
--
-- `events` is one of the seven tables with column-level ACLs, so this revokes by COLUMN. A
-- `revoke all on table` here would drop the column list with it.

create function public.snap_event_geo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- geo is geography(Point, 4326): st_x is the longitude, st_y the latitude. st_point(long, lat)
  -- and the bare ::geography cast are the shape create_event has always written.
  new.geo := extensions.st_point(
    floor(extensions.st_x(new.geo::extensions.geometry) * 40 + 0.5) / 40,
    floor(extensions.st_y(new.geo::extensions.geometry) * 40 + 0.5) / 40
  )::extensions.geography;
  return new;
end;
$$;

comment on function public.snap_event_geo() is
  'Snaps events.geo to a 0.025° grid (40 cells per degree, floor(x * 40 + 0.5) / 40 on each axis) on every INSERT and every UPDATE OF geo (#781). One cell is at least 3 km² at Italian latitudes — Play''s bar for approximate location. Mirrored by @athanor/core snapToEventGrid; geo-grid.mirror.test.ts reads both.';

create trigger events_snap_geo
  before insert or update of geo on public.events
  for each row
  when (new.geo is not null)
  execute function public.snap_event_geo();

-- #409: a trigger function is invoked by the trigger, never called by a role, and the
-- pg_default_acl 'f' row hands EXECUTE to anon and authenticated on every CREATE. EXECUTE on a
-- trigger function is checked when the TRIGGER is created, not when it fires, so this does not
-- reach the service-role writes the staging seed makes.
revoke execute on function public.snap_event_geo() from public, anon, authenticated;

-- ── the backfill ──────────────────────────────────────────────────────────────────────────────
-- Every stored point, soft-deleted rows included: a deleted row is still in the table, and the
-- promise is about what is stored. `set geo = geo` names the column, so the trigger above snaps
-- it. It also bumps updated_at through events_touch_updated_at — the only other UPDATE trigger on
-- the table — and nothing reads that as a change an attendee is told about. No CHECK on events
-- is NOT VALID, so re-checking the touched rows cannot refuse one. Idempotent by construction.
update public.events set geo = geo where geo is not null;

revoke select (geo) on table public.events from anon;

revoke execute on function public.events_nearby(
  double precision, double precision, double precision, double precision, uuid, integer
) from anon;

comment on column public.events.geo is
  'The event''s point, geography(Point,4326), snapped to a 0.025° grid by events_snap_geo on every write path (20260919124730, #781) — never finer than an area of 3 km² at Italian latitudes. NULL for online events. Not granted to anon; members read it through the authenticated grant and events_nearby().';

comment on function public.events_nearby(
  double precision, double precision, double precision, double precision, uuid, integer
) is
  'Signed-in «Vicino»: events within radius_m of (lat, long), nearest first, keyset-paged on (dist_meters, id). SECURITY INVOKER, so the caller''s column privilege on events.geo is what lets it compute a distance — which is why anon has held no EXECUTE on it since 20260919124730 (#781). The distance it returns is to the grid point, never to a device fix.';
