-- #105 — capacity enforced on both paths.
-- Paid path: claim_event_seat (pre-charge pending claim under the events-row lock),
-- release_event_seat, event_seats_taken. Free path: the rsvps_enforce_capacity trigger.
-- The concurrency property rides on the FOR UPDATE lock; what is testable sequentially —
-- and what actually closes the race once claims serialize — is that the count includes
-- other members' UNEXPIRED pending claims, excludes expired ones, and that the belt
-- refuses paid rows. Asserted here.
-- #258 — a LIVE own claim refuses a second claim ('claim_pending'): the claim outlives
-- the Session it backs, so at most one payable Session exists per (user, event). The
-- refusal must not extend the claim, must end with the TTL, and must not touch refunded
-- re-buys — all asserted here.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- organizer A + members B, C, D (handle_new_user auto-creates profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','organizer@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','b@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','c@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated','authenticated','d@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- A creates a paid event (capacity 2) and a free event (capacity 2)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents, capacity)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
          'Masterclass','formazione',true,'https://stream.athanor.test/x', now() + interval '1 day', 1500, 2),
         ('ffffffff-ffff-ffff-ffff-ffffffffffff','11111111-1111-1111-1111-111111111111',
          'Cerchio aperto','benessere',true,'https://stream.athanor.test/y', now() + interval '1 day', 0, 2);
reset role;

-- ── paid path: claim_event_seat ──────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claimed') $$, 'B claims seat 1 of 2');
reset role;

select ok((select status = 'pending' and expires_at > now() from public.event_tickets
  where user_id='22222222-2222-2222-2222-222222222222'
    and event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'a claim is a pending row with a future expiry');

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claimed') $$, 'C claims seat 2 of 2');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('sold_out') $$, 'a full event refuses the next claim — another member''s PENDING claim holds a seat');
reset role;

-- C abandons: expire the claim (the TTL is a predicate, not a sweep)
update public.event_tickets set expires_at = now() - interval '1 minute'
  where user_id='33333333-3333-3333-3333-333333333333';

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claimed') $$, 'an EXPIRED pending claim holds no seat');
reset role;

-- #258 — D's claim is LIVE: a second claim (the concurrent double checkout) must refuse,
-- and the refusal must not touch the row — a refreshed expiry would let retries roll the
-- lockout forward forever.
create temp table d_claim_before as
  select expires_at from public.event_tickets
  where user_id='44444444-4444-4444-4444-444444444444'
    and event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claim_pending') $$,
  'a LIVE own claim refuses a second claim — the concurrent double checkout dies here (#258)');
reset role;

select ok((select t.expires_at = b.expires_at
  from public.event_tickets t, d_claim_before b
  where t.user_id='44444444-4444-4444-4444-444444444444'
    and t.event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'the refusal leaves the claim untouched — no retry can extend the lockout');

-- D's claim lapses: the refusal ends with the TTL, never a permanent lockout
update public.event_tickets set expires_at = now() - interval '1 minute'
  where user_id='44444444-4444-4444-4444-444444444444'
    and event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claimed') $$, 'an expired OWN claim re-claims — the lockout is the TTL, not forever');
reset role;

select results_eq($$ select count(*)::int from public.event_tickets
  where user_id='44444444-4444-4444-4444-444444444444' $$, $$ values (1) $$,
  'a re-claim reuses the row (unique user+event)');

-- the webhook pays B's claim
update public.event_tickets set status='paid', expires_at=null, stripe_payment_id='pi_1', qr_token='tok.b'
  where user_id='22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('already_owned') $$, 'a paid row refuses a new claim (fail-closed belt)');
reset role;

select ok((select status = 'paid' and stripe_payment_id = 'pi_1' from public.event_tickets
  where user_id='22222222-2222-2222-2222-222222222222'),
  'the refused claim did not touch the paid row');

-- seats now held: B paid + D pending (unexpired); C's expired claim does not count
select results_eq($$ select public.event_seats_taken('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values (2) $$, 'event_seats_taken counts paid + unexpired pending, not expired claims');

-- release: own pending goes, a paid row never does
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok($$ select public.release_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  'D releases their pending claim');
reset role;
select results_eq($$ select count(*)::int from public.event_tickets
  where user_id='44444444-4444-4444-4444-444444444444' $$, $$ values (0) $$,
  'the released claim row is gone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$ select public.release_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  'release on a paid row is a no-op, not an error');
reset role;
select results_eq($$ select count(*)::int from public.event_tickets
  where user_id='22222222-2222-2222-2222-222222222222' $$, $$ values (1) $$,
  'a paid ticket cannot be released');

-- a refund frees the row for a genuine re-buy: #258 refuses only LIVE pending claims
update public.event_tickets set status='refunded', expires_at=null, qr_token=null
  where user_id='22222222-2222-2222-2222-222222222222'
    and event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  $$ values ('claimed') $$, 'a refunded row re-claims — the refusal is for live claims, not history');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select public.claim_event_seat('00000000-0000-0000-0000-00000000dead') $$,
  $$ values ('not_found') $$, 'an unknown event refuses the claim');
reset role;

-- anon can execute none of it
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select public.claim_event_seat('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') $$,
  '42501', null, 'anon cannot claim');
reset role;

-- the claim functions are the ONLY authenticated write path (0025 asserts the rest)
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$
  insert into public.event_tickets (user_id, event_id, status)
  values ('44444444-4444-4444-4444-444444444444','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','pending')
$$, '42501', null, 'a client still cannot write a claim row directly');
reset role;

-- ── free path: the rsvps trigger ─────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$ insert into public.rsvps (user_id, event_id, status)
  values ('22222222-2222-2222-2222-222222222222','ffffffff-ffff-ffff-ffff-ffffffffffff','going') $$,
  'B goes (1 of 2)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$ insert into public.rsvps (user_id, event_id, status)
  values ('33333333-3333-3333-3333-333333333333','ffffffff-ffff-ffff-ffff-ffffffffffff','going') $$,
  'C goes (2 of 2)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ insert into public.rsvps (user_id, event_id, status)
  values ('44444444-4444-4444-4444-444444444444','ffffffff-ffff-ffff-ffff-ffffffffffff','going') $$,
  'P0001', 'sold out', 'a full event refuses the next RSVP');
select lives_ok($$ insert into public.rsvps (user_id, event_id, status)
  values ('44444444-4444-4444-4444-444444444444','ffffffff-ffff-ffff-ffff-ffffffffffff','cancelled') $$,
  'only going is gated — a cancelled row passes');
reset role;

-- re-confirming while full must not refuse: the member's own row is replaced, not added
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$ update public.rsvps set status='going'
  where user_id='22222222-2222-2222-2222-222222222222'
    and event_id='ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  'a member already going can re-confirm at capacity');
reset role;

-- a cancellation frees the seat
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$ update public.rsvps set status='cancelled'
  where user_id='33333333-3333-3333-3333-333333333333'
    and event_id='ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  'C cancels');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok($$ update public.rsvps set status='going'
  where user_id='44444444-4444-4444-4444-444444444444'
    and event_id='ffffffff-ffff-ffff-ffff-ffffffffffff' $$,
  'the freed seat admits the next member');
reset role;

select * from finish();
rollback;
