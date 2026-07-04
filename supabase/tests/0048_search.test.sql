begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ── seed: two users (handle_new_user trigger auto-creates public.profiles rows) ────────────────

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   'authenticated', 'authenticated', 'search_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   'authenticated', 'authenticated', 'search_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- enrich profiles for text-match. Handles share the 'videomaker' prefix for equal trigram similarity.
-- Bios are identical so the full concatenated string produces the same similarity score for both
-- (making the ranking tie-break by id deterministic — see assertion 4b).
-- The update runs as the implicit postgres/superuser role (test runner).
update public.profiles
  set handle = 'videomaker_aa', bio = 'artista creatore'
  where id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
update public.profiles
  set handle = 'videomaker_bb', bio = 'artista creatore'
  where id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

-- ── service-role seeding (money state + event/project data written only by the backend) ─────────

set local role service_role;

-- aura_scores: user_a=500, user_b=100 (different → proves filter gate and ranking assertions).
insert into public.aura_scores (profile_id, score)
  values
    ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 500),
    ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 100)
  on conflict (profile_id) do update set score = excluded.score;

-- project seeded as soft-deleted (deleted_at set) — must be ABSENT from results (assertion 6).
insert into public.projects (id, author_id, title, category, description, deleted_at)
  values (
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'videomaker workshop deleted', 'artistic', 'videomaker skills', now()
  );

-- live event that matches 'videomaker' — must appear in results (assertion 6).
-- online + stream_url to satisfy the events_online_or_physical check
-- ((is_online AND stream_url IS NOT NULL) OR (NOT is_online AND geo IS NOT NULL)) without needing PostGIS geo.
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, ends_at)
  values (
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'videomaker festival live', 'formazione', true, 'https://athanor.test/live',
    now() + interval '7 days', now() + interval '8 days'
  );

-- make user_a a Circle member (service-role only — rule #6, money-state is a cache of Stripe).
-- user_b remains a non-member (zero circle_memberships rows → entitlements.advanced_filters=false).
insert into public.circle_memberships (profile_id, stripe_customer_id, plan, status, founding_member)
  values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'cus_search_test', 'monthly', 'active', false);

reset role;

-- ── assertion 1: function exists, is INVOKER, grants are correct ─────────────────────────────────

select has_function(
  'public', 'search_all',
  ARRAY['text','text','real','uuid','integer','integer','text','text'],
  'public.search_all exists with correct signature'
);

-- prosecdef = false → SECURITY INVOKER (not DEFINER)
select ok(
  not (select p.prosecdef
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'search_all'
         and pg_get_function_identity_arguments(p.oid) =
             'q text, scope text, cursor_rank real, cursor_id uuid, page_size integer, f_aura_min integer, f_city text, f_star text'),
  'search_all is SECURITY INVOKER (prosecdef = false)'
);

select is(
  has_function_privilege('anon',
    'public.search_all(text,text,real,uuid,integer,integer,text,text)', 'execute'),
  false,
  'anon cannot execute search_all (revoke enforced)'
);

select is(
  has_function_privilege('authenticated',
    'public.search_all(text,text,real,uuid,integer,integer,text,text)', 'execute'),
  true,
  'authenticated can execute search_all (grant enforced)'
);

-- ── assertion 2: min-length guard ────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

select is(
  (select count(*)::int from public.search_all('a')),
  0,
  'query of length 1 returns 0 rows (min-length guard)'
);

-- ── assertion 3: filter gate (Circle members only) ───────────────────────────────────────────────
--
-- Both handles match 'videomaker'. f_aura_min=400: only user_a (score=500) passes.
-- Non-member (user_b) passing f_aura_min gets the UNFILTERED set (filter silently ignored).
-- Member (user_a) with same filter gets the FILTERED set (only user_a returned).

set local request.jwt.claims = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

select is(
  (select count(*)::int
   from public.search_all('videomaker', 'people', null, null, 20, 400, null, null)),
  2,
  'non-member: f_aura_min silently ignored → unfiltered (both users returned)'
);

set local request.jwt.claims = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

select is(
  (select count(*)::int
   from public.search_all('videomaker', 'people', null, null, 20, 400, null, null)),
  1,
  'member: f_aura_min=400 applied → only user_a (score=500) returned, user_b (score=100) excluded'
);

-- ── assertion 4: ranking ≠ reputation (rule #1) ───────────────────────────────────────────────────
--
-- 4a (static): function body must NOT order by any aura/circle/entitlement column.
select ok(
  (select pg_get_functiondef('public.search_all(text, text, real, uuid, integer, integer, text, text)'::regprocedure)) not ilike '%order by%aura%'
  and (select pg_get_functiondef('public.search_all(text, text, real, uuid, integer, integer, text, text)'::regprocedure)) not ilike '%order by%circle%'
  and (select pg_get_functiondef('public.search_all(text, text, real, uuid, integer, integer, text, text)'::regprocedure)) not ilike '%order by%entitlement%',
  'search_all body: ORDER BY contains no aura/circle/entitlement column (static check)'
);

-- 4b (behavioral): user_a and user_b have identical bios → equal trigram similarity for 'videomaker'.
-- They differ in aura (a=500, b=100). Result order must be by (rank desc, id desc), NOT aura desc.
-- 'b2b2...' > 'a1a1...' lexicographically → correct order: b first, a second.
-- If incorrectly ranked by aura: user_a (500) would appear first.
select is(
  (select array_agg(id order by rank desc, id desc)
   from public.search_all('videomaker', 'people', null, null, 20, null, null, null)),
  ARRAY[
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid,
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid
  ],
  'ranking is by (rank desc, id desc) — not by aura score (b higher uuid → b first)'
);

-- ── assertion 5: keyset cursor (rule #9) ─────────────────────────────────────────────────────────
--
-- page_size=1: page 1 returns the higher-id user (b); page 2 via keyset cursor returns user_a.
-- Pages are disjoint. No offset parameter exists on the function.

select is(
  (select id from public.search_all('videomaker', 'people', null, null, 1, null, null, null) limit 1),
  'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid,
  'page 1 (page_size=1) returns user_b (higher uuid, tied rank → first by id desc)'
);

select is(
  (select id from public.search_all(
     'videomaker', 'people',
     (select rank from public.search_all('videomaker','people',null,null,1,null,null,null) limit 1),
     (select id   from public.search_all('videomaker','people',null,null,1,null,null,null) limit 1),
     1, null, null, null
   ) limit 1),
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
  'page 2 (keyset cursor from page 1) returns user_a — disjoint from page 1 (no offset)'
);

-- ── assertion 6: RLS composes through the invoker RPC (real-today form) ──────────────────────────
--
-- Profiles and projects are authenticated-world-readable today (blocks table and is_visible_to_me
-- arrive in M9). The observable RLS filtering today: soft-deleted rows are NEVER surfaced.
--
-- Soft-deleted project (deleted_at set) must be ABSENT even though its title text-matches.
select is(
  (select count(*)::int
   from public.search_all('videomaker', 'projects', null, null, 20, null, null, null)),
  0,
  'soft-deleted project absent from results (projects SELECT RLS: deleted_at is null — composes through invoker)'
);

-- Live event with matching title must be PRESENT (event SELECT RLS: deleted_at is null).
select is(
  (select count(*)::int
   from public.search_all('videomaker', 'events', null, null, 20, null, null, null)),
  1,
  'live event present in results (events SELECT RLS passes through invoker)'
);

-- TODO(M9): when blocks + is_visible_to_me land, assert (a) a members/private profile the caller
-- can't read is absent, (b) a blocked user's rows are absent — the security-invoker RPC inherits
-- both for free.

-- ── assertion 7: zero Aura — search writes nothing (rule #1) ─────────────────────────────────────

select is(
  (select count(*)::int from public.aura_events),
  0,
  'running search_all produces ZERO aura_events (search never awards points)'
);

reset role;

select * from finish();
rollback;
