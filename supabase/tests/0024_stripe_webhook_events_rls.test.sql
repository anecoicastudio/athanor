begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- one member, to attempt a client write
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','member@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- shape
select has_table('public','stripe_webhook_events','stripe_webhook_events table exists');
select ok((select relrowsecurity from pg_class where oid='public.stripe_webhook_events'::regclass),
  'RLS enabled on stripe_webhook_events');
select policies_are('public','stripe_webhook_events', array[]::text[],
  'no client policies (service role only)');

-- authenticated client cannot read (no grant) → 42501
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select * from public.stripe_webhook_events $$,
  '42501', null, 'authenticated client cannot read the ledger');
select throws_ok($$
  insert into public.stripe_webhook_events (event_id, type, payload)
  values ('evt_test', 'checkout.session.completed', '{}'::jsonb)
$$, '42501', null, 'authenticated client cannot insert into the ledger');
reset role;

-- anon cannot read or write → 42501
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select * from public.stripe_webhook_events $$,
  '42501', null, 'anon cannot read the ledger');
select throws_ok($$
  insert into public.stripe_webhook_events (event_id, type, payload)
  values ('evt_anon_test', 'checkout.session.completed', '{}'::jsonb)
$$, '42501', null, 'anon cannot insert into the ledger');
reset role;

select * from finish();
rollback;
