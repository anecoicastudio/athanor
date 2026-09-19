begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- #781 — an event's point is approximate by construction (ruling 2026-09-19). Two halves, and this
-- file owns both:
--   * the GRID: events_snap_geo snaps every write to `geo` to a 0.025° lattice — forty cells per
--     degree, `floor(x * 40 + 0.5) / 40` per axis — on the RPC path, the direct-INSERT path and the
--     service-role path alike. `@athanor/core`'s snapToEventGrid is the phone's copy, and
--     `geo-grid.mirror.test.ts` keeps the two spellings equal.
--   * the GRANT: anon holds neither the column nor EXECUTE on events_nearby(); authenticated keeps
--     both, because the signed-in «Vicino» runs the INVOKER function as the member.
--
-- Stored coordinates are compared as float8 with is(): the trigger's arithmetic is exact IEEE, so
-- 1819 / 40 is the same double as the literal 45.475, and an off-by-an-ulp result is a real drift.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'grid_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── the trigger's shape ───────────────────────────────────────────────────────────────────────
select has_trigger('public', 'events', 'events_snap_geo', 'events carries the grid trigger');
select matches(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgname = 'events_snap_geo' and tgrelid = 'public.events'::regclass),
  'BEFORE INSERT OR UPDATE OF geo ON public\.events FOR EACH ROW WHEN \(\(new\.geo IS NOT NULL\)\)',
  'the grid fires BEFORE every INSERT and every UPDATE OF geo, for a non-null point'
);

-- ── the RPC path ──────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($$
  select public.create_event('Griglia via RPC','arte',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.46421, 9.19034)
$$, 'create_event still creates a physical event');

select is(
  (select extensions.st_y(geo::extensions.geometry) from public.events where title = 'Griglia via RPC'),
  45.475::float8, 'create_event: the latitude is stored on the grid (45.46421 → 45.475)');
select is(
  (select extensions.st_x(geo::extensions.geometry) from public.events where title = 'Griglia via RPC'),
  9.2::float8, 'create_event: the longitude is stored on the grid (9.19034 → 9.2)');

-- ── the direct-INSERT path (events_insert_own + the column INSERT grant on geo) ────────────────
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('11111111-1111-1111-1111-111111111111', 'Griglia via INSERT', 'musica', false, 'Spazio X',
          extensions.st_point(9.1874, 45.4624)::extensions.geography, now() + interval '7 days')
$$, 'a direct INSERT of a raw point still succeeds');

select is(
  (select array[extensions.st_y(geo::extensions.geometry), extensions.st_x(geo::extensions.geometry)]
     from public.events where title = 'Griglia via INSERT'),
  array[45.45, 9.175]::float8[],
  'direct INSERT: a raw device fix is snapped too — the grid is the table''s, not the RPC''s');

-- A true half-cell tie: 0.0625 is 1/16, exactly 2.5 cells. floor(x * 40 + 0.5) breaks it upward to
-- 0.075; Postgres round(float8) would break it to even (0.05) and disagree with the app.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('11111111-1111-1111-1111-111111111111', 'Griglia sul pareggio', 'musica', false, 'Spazio Z',
          extensions.st_point(-0.0625, 0.0625)::extensions.geography, now() + interval '7 days')
$$, 'a point on an exact half-cell is accepted');

select is(
  (select array[extensions.st_y(geo::extensions.geometry), extensions.st_x(geo::extensions.geometry)]
     from public.events where title = 'Griglia sul pareggio'),
  array[0.075, -0.05]::float8[],
  'a tie breaks upward on both signs, exactly as snapToEventGrid does');

-- An online event carries no point; the WHEN clause leaves the null alone.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, stream_url, starts_at)
  values ('11111111-1111-1111-1111-111111111111', 'Griglia online', 'arte', true,
          'https://example.test/live', now() + interval '7 days')
$$, 'an online event with no point still inserts');
select is(
  (select geo is null from public.events where title = 'Griglia online'), true,
  'a null geo stays null');

-- The signed-in «Vicino»: the member still runs events_nearby(), and the distance it reports is
-- to the grid point — from the grid point it is zero, whatever the organiser's phone reported.
select is(
  (select dist_meters from public.events_nearby(45.475, 9.2, 5000)
    where title = 'Griglia via RPC'),
  0::float8, 'authenticated: events_nearby measures to the grid point, never to the device fix');
reset role;

-- ── the service-role path and idempotence ─────────────────────────────────────────────────────
update public.events set geo = extensions.st_point(12.4964, 41.9028)::extensions.geography
 where title = 'Griglia via INSERT';
select is(
  (select array[extensions.st_y(geo::extensions.geometry), extensions.st_x(geo::extensions.geometry)]
     from public.events where title = 'Griglia via INSERT'),
  array[41.9, 12.5]::float8[],
  'an UPDATE OF geo is snapped as well (service role, the backfill''s own path)');

-- `set geo = geo` is the backfill's statement. Run twice over grid points, nothing moves.
create temporary table grid_before as
  select id, extensions.st_x(geo::extensions.geometry) as x, extensions.st_y(geo::extensions.geometry) as y
    from public.events where geo is not null;
update public.events set geo = geo where geo is not null;
select is_empty($$
  select b.id from grid_before b join public.events e on e.id = b.id
   where extensions.st_x(e.geo::extensions.geometry) <> b.x
      or extensions.st_y(e.geo::extensions.geometry) <> b.y
$$, 'the snap is idempotent: re-snapping a stored point leaves it where it is');

-- "On the grid" is spelled as "its own snap": k / 40 times 40 is not always an exact integer in
-- float8, but floor(x * 40 + 0.5) / 40 of a grid point returns the same double, exactly.
select is_empty($$
  select id from public.events
   where geo is not null
     and (extensions.st_x(geo::extensions.geometry) <> floor(extensions.st_x(geo::extensions.geometry) * 40 + 0.5) / 40
       or extensions.st_y(geo::extensions.geometry) <> floor(extensions.st_y(geo::extensions.geometry) * 40 + 0.5) / 40)
$$, 'no stored point is off the grid');

-- ── the grant ─────────────────────────────────────────────────────────────────────────────────
-- Privileges, not a refused read: a read that fails could be RLS swallowing it (rules/supabase-db.md).
select ok(not has_column_privilege('anon', 'public.events', 'geo', 'SELECT'),
  'anon holds no SELECT on events.geo (#781)');
select ok(not has_function_privilege('anon',
    'public.events_nearby(double precision, double precision, double precision, double precision, uuid, integer)',
    'EXECUTE'),
  'anon cannot execute events_nearby — nothing signed-out calls it, and without geo it could not answer');
select ok(has_column_privilege('authenticated', 'public.events', 'geo', 'SELECT'),
  'authenticated keeps geo: the signed-in «Vicino» runs the INVOKER function as the member');
select ok(has_function_privilege('authenticated',
    'public.events_nearby(double precision, double precision, double precision, double precision, uuid, integer)',
    'EXECUTE'),
  'authenticated keeps EXECUTE on events_nearby');

select * from finish();
rollback;
