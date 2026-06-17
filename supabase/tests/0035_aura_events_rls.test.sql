begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- two users: A (owner), B (unrelated member)
-- handle_new_user trigger auto-creates their public.profiles rows
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'aura_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'aura_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public', 'aura_events', 'aura_events table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.aura_events'::regclass),
  'RLS enabled on aura_events'
);
select policies_are(
  'public', 'aura_events',
  array['aura_events_select_own'],
  'exactly one policy: owner SELECT only (no client write path)'
);

-- anon: privilege revoked → cannot read
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.aura_events $$,
  '42501', null, 'anon cannot read aura_events'
);
reset role;

-- authenticated client: INSERT denied (no grant + no policy)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.aura_events (profile_id, type, points)
     values ('11111111-1111-1111-1111-111111111111', 'milestone_help', 40) $$,
  '42501', null, 'client INSERT into aura_events denied (engine-only)'
);
select throws_ok(
  $$ update public.aura_events set points = 9999 $$,
  '42501', null, 'client UPDATE denied (no grant)'
);
select throws_ok(
  $$ delete from public.aura_events $$,
  '42501', null, 'client DELETE denied (append-only, no grant)'
);
reset role;

-- service role CAN append (the engine path — bypasses RLS)
set local role service_role;
select lives_ok(
  $$ insert into public.aura_events (profile_id, type, points, ref_id)
     values ('11111111-1111-1111-1111-111111111111', 'milestone_help', 40, gen_random_uuid()) $$,
  'service role can append aura_events (engine write path)'
);
reset role;

-- owner (A) can read own event
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.aura_events where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'owner can read own aura_events row'
);

-- user B cannot read user A's events (cross-user = 0 rows)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.aura_events where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0) $$,
  'unrelated member cannot read another member''s aura_events (0 rows)'
);
reset role;

-- service role idempotency index: same (profile_id, type, ref_id) → 23505
set local role service_role;
select throws_ok(
  $$ insert into public.aura_events (profile_id, type, points, ref_id)
     values ('11111111-1111-1111-1111-111111111111', 'milestone_help', 40,
             (select ref_id from public.aura_events
              where profile_id = '11111111-1111-1111-1111-111111111111' limit 1)) $$,
  '23505', null, 'duplicate (profile_id, type, ref_id) rejected by idempotency index'
);
reset role;

select * from finish();
rollback;
