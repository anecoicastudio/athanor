begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- organizer A + attendee B (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','organizer@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','attendee@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- A's paid online event.
-- Seeded as service_role, not as the organiser: since #446 the client's INSERT grant on
-- events is column-scoped to the columns create_event writes, and `id` is not one of them.
-- This fixture wants a deterministic id to reference below, not an ownership check —
-- 0020_events_rls asserts an organiser's own INSERT.
--
-- A is identity-verified and the row carries settlement_ack_at because #448 gates paid events on
-- every write path — the events_enforce_paid_gate trigger fires for service_role too, unlike RLS.
-- A paid event by an unverified organiser is a row that can no longer exist; a fixture that made
-- one would be modelling an impossible world (0125 owns the refusals themselves).
update public.profiles set identity_verified = true
  where id = '11111111-1111-1111-1111-111111111111';
set local role service_role;
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents, settlement_ack_at)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
          'Masterclass','formazione',true,'https://stream.athanor.test/x', now() + interval '1 day', 1500, now());
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

-- Realtime publication membership. subscribeTicket() uses postgres_changes, which delivers
-- nothing at all for an unpublished table while still reporting SUBSCRIBED — the #88 walk
-- found the buyer's ticket subscription dead on staging AND production for exactly this
-- reason. A behaviour test cannot catch it (the client sees silence either way), so assert
-- the catalog.
select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_tickets'),
  1, 'event_tickets is published to supabase_realtime (subscribeTicket depends on it)');

-- The payload is the whole row because authenticated is granted SELECT on the whole row.
-- Stated as an identity, not a literal column list: event_tickets carries a signed QR door
-- pass, so the day someone narrows the grant on a column (the profiles pattern,
-- 20260811084600) without narrowing the publication, realtime would keep broadcasting it.
-- This goes red then; a hand-written list would silently stay true.
select bag_eq(
  $$ select unnest(attnames)::text from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='event_tickets' $$,
  $$ select column_name::text from information_schema.column_privileges
      where table_schema='public' and table_name='event_tickets'
        and grantee='authenticated' and privilege_type='SELECT' $$,
  'the event_tickets realtime payload IS the authenticated SELECT grant, not merely similar to it'
);

select * from finish();
rollback;
