begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- two users: A (organizer/scanner), B (attendee/holder), C (random member)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','att_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','att_b@test.athanor','{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','att_c@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public','event_attendance','event_attendance table exists');
select ok((select relrowsecurity from pg_class where oid='public.event_attendance'::regclass),
  'RLS enabled on event_attendance');
select policies_are('public','event_attendance',
  array['event_attendance_select_holder_or_organizer','event_attendance_insert_organizer'],
  'exactly the expected policies on event_attendance');

-- setup (service role, bypasses RLS): A organizes a paid event; B holds a paid ticket
set local role service_role;
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents)
values ('aaaaaaaa-0000-0000-0000-00000000aaaa','11111111-1111-1111-1111-111111111111',
        'Notte Live','networking',true,'https://x.test', now() + interval '1 day', 1500);
insert into public.event_tickets (id, user_id, event_id, status, qr_token)
values ('bbbbbbbb-0000-0000-0000-00000000bbbb','22222222-2222-2222-2222-222222222222',
        'aaaaaaaa-0000-0000-0000-00000000aaaa','paid','signed.real.token');
reset role;

-- A (organizer) checks B in
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.event_attendance (ticket_id, event_id, scanned_by)
  values ('bbbbbbbb-0000-0000-0000-00000000bbbb','aaaaaaaa-0000-0000-0000-00000000aaaa',
          '11111111-1111-1111-1111-111111111111')
$$, 'organizer can check in a ticket holder');

-- duplicate ticket_id → 23505 (idempotency unique)
select throws_ok($$
  insert into public.event_attendance (ticket_id, event_id, scanned_by)
  values ('bbbbbbbb-0000-0000-0000-00000000bbbb','aaaaaaaa-0000-0000-0000-00000000aaaa',
          '11111111-1111-1111-1111-111111111111')
$$, '23505', null, 'duplicate check-in for same ticket rejected (idempotent)');

-- A (organizer) can read the attendance row
select results_eq($$ select count(*)::int from public.event_attendance
  where ticket_id='bbbbbbbb-0000-0000-0000-00000000bbbb' $$,
  $$ values (1) $$, 'organizer can read attendance for their event');

-- IMMUTABLE record: no UPDATE/DELETE grant or policy → even the organizer cannot mutate a check-in
-- (corrections go through service role). Locks the "immutable" claim as a test, not just a comment.
select throws_ok($$
  update public.event_attendance set checked_in_at = now()
  where ticket_id='bbbbbbbb-0000-0000-0000-00000000bbbb'
$$, '42501', null, 'organizer cannot UPDATE a check-in (immutable)');
select throws_ok($$
  delete from public.event_attendance
  where ticket_id='bbbbbbbb-0000-0000-0000-00000000bbbb'
$$, '42501', null, 'organizer cannot DELETE a check-in (immutable)');

-- B (holder, non-organizer) CANNOT insert attendance → 42501 (organizer-only WITH CHECK)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  insert into public.event_attendance (ticket_id, event_id, scanned_by)
  values ('bbbbbbbb-0000-0000-0000-00000000bbbb','aaaaaaaa-0000-0000-0000-00000000aaaa',
          '22222222-2222-2222-2222-222222222222')
$$, '42501', null, 'non-organizer cannot check people in');

-- B (holder) CAN read their own check-in
select results_eq($$ select count(*)::int from public.event_attendance
  where ticket_id='bbbbbbbb-0000-0000-0000-00000000bbbb' $$,
  $$ values (1) $$, 'ticket holder can read own attendance');

-- C (random member) is neither holder nor organizer → reads 0
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.event_attendance
  where ticket_id='bbbbbbbb-0000-0000-0000-00000000bbbb' $$,
  $$ values (0) $$, 'unrelated member cannot read attendance');
reset role;

-- anon cannot insert (revoked + no policy) → 42501
set local role anon; set local request.jwt.claims = '';
select throws_ok($$
  insert into public.event_attendance (ticket_id, event_id, scanned_by)
  values ('bbbbbbbb-0000-0000-0000-00000000bbbb','aaaaaaaa-0000-0000-0000-00000000aaaa',
          '11111111-1111-1111-1111-111111111111')
$$, '42501', null, 'anon cannot insert attendance');
reset role;

select * from finish();
rollback;
