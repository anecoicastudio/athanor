begin;
select plan(10);

-- structure
select has_table('public', 'fund_editions', 'fund_editions exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_editions'::regclass),
  'RLS enabled on fund_editions'
);
select policies_are('public', 'fund_editions', array['fund_editions_select_public'],
  'exactly the public-select policy');

-- seed one edition as service_role
set local role service_role;
insert into public.fund_editions (year, target_at, goal_cents, phase)
  values (2027, now() + interval '30 days', 5000000, 'community');
reset role;

-- anon CAN read the heartbeat (contrast every other table)
set local role anon;
select is((select count(*)::int from public.fund_editions), 1, 'anon can read the edition (heartbeat)');
select throws_ok(
  $$insert into public.fund_editions (year, target_at, goal_cents) values (2099, now(), 100)$$,
  '42501', null, 'anon cannot insert an edition');
reset role;

-- authenticated cannot write
set local role authenticated;
select throws_ok(
  $$insert into public.fund_editions (year, target_at, goal_cents) values (2099, now(), 100)$$,
  '42501', null, 'authenticated cannot insert an edition');
select throws_ok(
  $$update public.fund_editions set phase = 'closed'$$,
  '42501', null, 'authenticated cannot update an edition');
reset role;

-- service_role can write
set local role service_role;
select lives_ok(
  $$update public.fund_editions set phase = 'reputation' where year = 2027$$,
  'service_role can update the edition');
reset role;

select is(
  (select count(*)::int from public.fund_editions where phase = 'reputation'),
  1, 'service_role update landed');

select * from finish();
rollback;
