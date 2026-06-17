begin;
select plan(11);

select has_table('public', 'fund_aggregates', 'fund_aggregates exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_aggregates'::regclass),
  'RLS enabled on fund_aggregates'
);
select policies_are('public', 'fund_aggregates', array['fund_aggregates_select_public'],
  'exactly the public-select policy');

-- seed an edition + its aggregate as service_role
set local role service_role;
insert into public.fund_editions (id, year, target_at, goal_cents)
  values ('00000000-0000-0000-0000-0000000000a1', 2028, now() + interval '10 days', 1000000);
insert into public.fund_aggregates (edition_id, raised_cents, contributor_count)
  values ('00000000-0000-0000-0000-0000000000a1', 48328100, 13874);
reset role;

-- anon CAN read the public total but cannot write
set local role anon;
select is((select raised_cents from public.fund_aggregates
           where edition_id = '00000000-0000-0000-0000-0000000000a1'),
          48328100::bigint, 'anon can read the public fund total');
select throws_ok(
  $$insert into public.fund_aggregates (edition_id) values ('00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'anon cannot insert an aggregate');
reset role;

-- authenticated cannot inflate / write the aggregate
set local role authenticated;
select throws_ok(
  $$update public.fund_aggregates set raised_cents = 999999999$$,
  '42501', null, 'authenticated cannot inflate the fund total');
select throws_ok(
  $$insert into public.fund_aggregates (edition_id) values ('00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'authenticated cannot insert an aggregate');
select throws_ok(
  $$delete from public.fund_aggregates$$,
  '42501', null, 'authenticated cannot delete an aggregate');
reset role;

-- service_role can recompute
set local role service_role;
select lives_ok(
  $$update public.fund_aggregates set raised_cents = 48328200
    where edition_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'service_role can update the aggregate');
reset role;

-- realtime publication membership (the ticker depends on it)
select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fund_aggregates'),
  1, 'fund_aggregates is published to supabase_realtime');

-- rule #1: a fund aggregate creates ZERO aura events
select is(
  (select count(*)::int from public.aura_events),
  0, 'no aura_events exist from a fund aggregate (fund = 0 Aura)');

select * from finish();
rollback;
