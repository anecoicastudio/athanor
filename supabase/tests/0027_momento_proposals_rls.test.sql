begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','user_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','user_b@test.athanor','{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','user_c@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public','momento_proposals','momento_proposals exists');
select ok((select relrowsecurity from pg_class where oid='public.momento_proposals'::regclass),'RLS enabled');
select policies_are('public','momento_proposals',
  array['momento_proposals_select_own','momento_proposals_update_own'],'expected policies (no insert/delete)');

-- seed as SERVICE ROLE (the only writer): A←B and B←A (reciprocal, so accept_momento can match)
set local role service_role;
insert into public.momento_proposals (user_id, candidate_id, reasons, affinity, daily_rank) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', array['Condividete: design'], 0.87, 1),
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111', array['Condividete: design'], 0.87, 1);
reset role;

-- anon: revoked entirely
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select count(*) from public.momento_proposals $$,'42501',null,'anon cannot read');
reset role;

-- recipient A reads own (exactly the 1 row addressed to A)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.momento_proposals $$, $$ values (1) $$,
  'recipient reads own proposal');

-- invariant #3: affinity not readable
select throws_ok($$ select affinity from public.momento_proposals $$,'42501',null,
  'client cannot read affinity score');

-- invariant #2: no client INSERT
select throws_ok(
  $$ insert into public.momento_proposals (user_id, candidate_id, reasons, daily_rank)
     values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', array['forged'], 2) $$,
  '42501', null, 'client cannot insert a proposal');

-- invariant #2: can't forge reasons/affinity even on own row (column grant blocks the columns)
select throws_ok($$ update public.momento_proposals set reasons = array['hacked']
                    where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'client cannot rewrite reasons');

-- accept_momento: A accepts → reciprocal (B) not yet accepted → matched false
select is(
  (select (public.accept_momento(
     (select id from public.momento_proposals
        where user_id='11111111-1111-1111-1111-111111111111'))->>'matched')),
  'false', 'first accept is not yet mutual');

-- now B accepts → reciprocal of A is accepted → matched true
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select (public.accept_momento(
     (select id from public.momento_proposals
        where user_id='22222222-2222-2222-2222-222222222222'))->>'matched')),
  'true', 'reciprocal accept reports a mutual match');

-- non-recipient cannot read others' proposals (directed read): B sees only its own row
select results_eq($$ select count(*)::int from public.momento_proposals
                     where user_id='11111111-1111-1111-1111-111111111111' $$, $$ values (0) $$,
  'non-recipient cannot read others'' proposals');
reset role;

-- invariant #1: a 4th row for the same (user, day) collides on daily_rank
set local role service_role;
select throws_ok(
  $$ insert into public.momento_proposals (user_id, candidate_id, daily_rank)
     values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', 1) $$,
  '23505', null, 'duplicate (user, day, daily_rank) rejected (cap + dedupe guard)');
reset role;

-- guard branch: a LEGAL pass sets passed_until = proposed_on + 90 (PRD §4.7 no-re-propose window).
-- Seed a fresh isolated proposal for user C (candidate = B) so the accepted A/B rows stay untouched.
set local role service_role;
insert into public.momento_proposals (user_id, candidate_id, reasons, affinity, daily_rank) values
  ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', array['Condividete: design'], 0.5, 1);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
-- legal pass as the row's owner (plain statement — the assertion below checks its effect)
update public.momento_proposals set status = 'passed'
  where user_id = '33333333-3333-3333-3333-333333333333';
select is(
  (select passed_until from public.momento_proposals
     where user_id = '33333333-3333-3333-3333-333333333333'),
  (select proposed_on + 90 from public.momento_proposals
     where user_id = '33333333-3333-3333-3333-333333333333'),
  'pass sets passed_until = proposed_on + 90');

-- guard branch: an ILLEGAL transition (accept→pass) on A's now-accepted row raises check_violation (23514).
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ update public.momento_proposals set status = 'passed'
     where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'accept→pass illegal transition rejected');
reset role;

select * from finish();
rollback;
