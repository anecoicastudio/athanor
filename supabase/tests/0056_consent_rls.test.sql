begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'consent_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'consent_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

-- rule #1 baseline: the global Aura count before any consent write (a delta, so the check holds
-- on a seeded world as well as on CI's empty stack)
select set_config('test.aura0', (select count(*) from public.aura_events)::text, false);

select has_table('public', 'consent', 'table exists');

-- Exhaustive (issue #271, was #138): consent is the GDPR record — exactly where a
-- silently-added read policy matters most. The behavioural probes below cannot catch an
-- ADDED policy; this list can. Owner CRUD-minus-delete = exactly these three.
select policies_are(
  'public', 'consent',
  array['consent_select_own', 'consent_insert_own', 'consent_update_own'],
  'exactly the expected policies exist on consent');

-- anon fully denied
set local role anon;
select throws_ok($$ select * from public.consent $$, '42501', null, 'anon denied');

-- owner inserts own
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'analytics', false, 'settings') $$,
  'owner inserts own consent');

-- cannot forge a consent row for ANOTHER profile (insert_own WITH CHECK)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.b')::uuid, 'analytics', true, 'settings') $$,
  '42501', null, 'cannot forge consent for another profile');

-- unique (profile_id, kind)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'analytics', true, 'settings') $$,
  '23505', null, 'duplicate (profile_id,kind) rejected');

-- «never_sold» is constitutional, not a stored kind (check constraint excludes it)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'never_sold', true, 'settings') $$,
  '23514', null, 'never_sold kind rejected — guarantee, not a toggle');

-- #841: `comms` is retired. The CHECK accepts exactly the two live kinds…
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conrelid = 'public.consent'::regclass and c.conname = 'consent_kind_check'),
  $$CHECK ((kind = ANY (ARRAY['analytics'::text, 'location_approx'::text])))$$,
  'consent_kind_check accepts exactly analytics and location_approx');

-- …and an old build's switch (the Play build predating PR 840) still writes `comms`, as an
-- upsert. It must succeed with nothing written — a 23514 would toast on every tap there.
select lives_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'comms', true, 'settings') $$,
  'retired comms insert succeeds (old-build safety)');
select lives_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'comms', false, 'settings')
     on conflict (profile_id, kind) do update set granted = excluded.granted $$,
  'retired comms upsert succeeds (the PostgREST shape)');

-- the trigger that makes it succeed is the only thing between the old build and the CHECK
select trigger_is(
  'public', 'consent', 'consent_discard_retired_kind',
  'athanor', 'consent_discard_retired_kind',
  'consent_discard_retired_kind discards comms before the CHECK');

-- non-owner update affects 0 rows (not an error)
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
-- (data-modifying CTE must be top-level, not inside is() — capture the count via set_config)
with upd as (
  update public.consent set granted = true
  where profile_id = current_setting('test.a')::uuid returning 1)
select set_config('test.upd_count', count(*)::text, true) from upd;
select is(current_setting('test.upd_count')::int, 0, 'non-owner update affects 0 rows');

-- owner reads own only
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select is(
  (select count(*)::int from public.consent),
  1, 'owner sees only own consent');

-- no `comms` row exists anywhere, the old-build writes above included. On CI's empty replay this
-- proves the trigger, not the migration's DELETE (the table is empty when it runs); the DELETE
-- was proven on staging, 24 seeded rows to 0.
set local role service_role;
select is(
  (select count(*)::int from public.consent where kind = 'comms'),
  0, 'no comms consent row is stored (#841)');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);

-- client DELETE denied (owner CRUD-minus-delete; hosted-revoke lockdown)
select throws_ok(
  $$ delete from public.consent where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client DELETE denied');

-- rule #1: consent writes zero Aura, to anyone — the global count has not moved
set local role service_role;
select is(
  (select count(*)::int from public.aura_events),
  current_setting('test.aura0')::int, 'consent path writes zero Aura (rule #1)');

select * from finish();
rollback;
