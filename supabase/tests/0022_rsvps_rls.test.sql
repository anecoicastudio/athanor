begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- two members; handle_new_user trigger auto-creates their profiles
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','user_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','user_b@test.athanor','{"locale":"en"}'::jsonb, now(), now());

-- schema shape
select has_table('public','rsvps','rsvps table exists');
select ok((select relrowsecurity from pg_class where oid='public.rsvps'::regclass), 'RLS enabled on rsvps');
select policies_are('public','rsvps',
  array['rsvps_select_authenticated','rsvps_insert_own','rsvps_update_own',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on rsvps');

-- A (organizer) creates a free physical event to RSVP to
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',
          'Notte delle Idee','networking',false,'Spazio X',
          extensions.st_point(13.405, 52.52)::extensions.geography, now() + interval '7 days');
reset role;

-- B inserts own RSVP (lives_ok)
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  insert into public.rsvps (user_id, event_id, status)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','going')
$$, 'member can RSVP to an event');

-- duplicate (user_id,event_id) → 23505 (idempotency unique)
select throws_ok($$
  insert into public.rsvps (user_id, event_id, status)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','going')
$$, '23505', null, 'duplicate RSVP violates the idempotency unique');

-- B cannot insert an RSVP on behalf of A → 42501
select throws_ok($$
  insert into public.rsvps (user_id, event_id, status)
  values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','going')
$$, '42501', null, 'cannot RSVP on behalf of another user');

-- B can flip own status to cancelled (lives_ok)
select lives_ok($$
  update public.rsvps set status='cancelled'
  where user_id='22222222-2222-2222-2222-222222222222'
    and event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
$$, 'owner can cancel own RSVP (status flip)');
reset role;

-- A (member) can read B's RSVP — attendee count is allowed (not a vanity metric)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq($$
  select count(*)::int from public.rsvps where event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
$$, $$ values (1) $$, 'members can read RSVPs (attendee count)');

-- A cannot update B's RSVP → 0 rows
select results_eq($$
  with u as (
    update public.rsvps set status='going'
    where user_id='22222222-2222-2222-2222-222222222222' returning 1)
  select count(*)::int from u
$$, $$ values (0) $$, 'cross-user update of another RSVP affects zero rows');
reset role;

-- anon is denied entirely (revoke all from anon + authenticated-only policies)
set local role anon; set local request.jwt.claims = '';
select throws_ok($$
  insert into public.rsvps (user_id, event_id, status)
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','going')
$$, '42501', null, 'anon cannot RSVP');
reset role;

select * from finish();
rollback;
