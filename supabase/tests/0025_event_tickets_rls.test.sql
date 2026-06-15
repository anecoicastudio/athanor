begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- organizer A + attendee B (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','organizer@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','attendee@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- A creates a paid online event
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
          'Masterclass','formazione',true,'https://stream.athanor.test/x', now() + interval '1 day', 1500);
reset role;

-- service-role analog (superuser): the webhook issues B's paid ticket
insert into public.event_tickets (user_id, event_id, status, stripe_payment_id, qr_token)
  values ('22222222-2222-2222-2222-222222222222','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          'paid','pi_test_123','signed.real.token');

-- shape
select has_table('public','event_tickets','event_tickets table exists');
select ok((select relrowsecurity from pg_class where oid='public.event_tickets'::regclass),
  'RLS enabled on event_tickets');
select policies_are('public','event_tickets', array['event_tickets_select_own'],
  'exactly one policy: read-own (no client write)');

-- B reads OWN ticket
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.event_tickets
  where user_id='22222222-2222-2222-2222-222222222222' $$, $$ values (1) $$, 'owner reads own ticket');

-- B cannot INSERT a paid ticket (no grant/policy) → 42501
select throws_ok($$
  insert into public.event_tickets (user_id, event_id, status)
  values ('22222222-2222-2222-2222-222222222222','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','paid')
$$, '42501', null, 'client cannot insert a paid ticket');

-- B cannot UPDATE status/qr_token (no grant/policy) → 42501
select throws_ok($$
  update public.event_tickets set status='checked_in', qr_token='forged'
  where user_id='22222222-2222-2222-2222-222222222222'
$$, '42501', null, 'client cannot update money/status/qr_token');

-- B cannot DELETE its ticket (no grant/policy) → 42501
select throws_ok($$
  delete from public.event_tickets
  where user_id='22222222-2222-2222-2222-222222222222'
$$, '42501', null, 'client cannot delete a ticket');
reset role;

-- A (organizer, not the ticket holder) cannot read B's ticket (it carries the QR)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.event_tickets
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' $$, $$ values (0) $$,
  'non-owner (even the organizer) cannot read another member''s ticket');
reset role;

-- anon cannot read → 42501
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select * from public.event_tickets $$,
  '42501', null, 'anon cannot read tickets');
reset role;

select * from finish();
rollback;
