begin;
select plan(14);

select has_table('public', 'remote_config', 'remote_config exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.remote_config'::regclass),
  'RLS enabled on remote_config'
);
select policies_are('public', 'remote_config', array['remote_config_select_public'],
  'exactly the public-select policy');

-- seed well-known keys as service_role
set local role service_role;
select lives_ok(
  $$insert into public.remote_config (key, value) values
      ('min_app_version', '{"ios":"1.0.0","android":"1.0.0"}'::jsonb),
      ('maintenance_mode', '{"enabled":false,"eta":null}'::jsonb),
      ('prime_stelle_enabled', '{"enabled":false}'::jsonb),
      ('fund_contributions_enabled', '{"enabled":false}'::jsonb)$$,
  'service_role can write well-formed config');
reset role;

-- anon (pre-auth boot) CAN read but CANNOT write
set local role anon;
select is(
  (select value ->> 'android' from public.remote_config where key = 'min_app_version'),
  '1.0.0', 'anon can read remote_config at boot');
select throws_ok(
  $$insert into public.remote_config (key, value) values ('x', '{"enabled":true}'::jsonb)$$,
  '42501', null, 'anon cannot insert config');
reset role;

-- authenticated CANNOT write either (permission denied, not RLS-filtered)
set local role authenticated;
select throws_ok(
  $$insert into public.remote_config (key, value) values ('x', '{"enabled":true}'::jsonb)$$,
  '42501', null, 'authenticated cannot insert config');
select throws_ok(
  $$update public.remote_config set value = '{"enabled":true}'::jsonb where key = 'maintenance_mode'$$,
  '42501', null, 'authenticated cannot update config');
select throws_ok(
  $$delete from public.remote_config where key = 'maintenance_mode'$$,
  '42501', null, 'authenticated cannot delete config');
reset role;

-- value-shape guard (23514) — the boot-outage safety net
set local role service_role;
select throws_ok(
  $$insert into public.remote_config (key, value) values ('min_app_version', '{}'::jsonb)$$,
  '23514', null, 'min_app_version requires ios + android');
select throws_ok(
  $$insert into public.remote_config (key, value) values ('maintenance_mode', '{"enabled":"yes"}'::jsonb)$$,
  '23514', null, 'maintenance_mode.enabled must be boolean');
select throws_ok(
  $$insert into public.remote_config (key, value) values ('some_new_flag', '{"foo":1}'::jsonb)$$,
  '23514', null, 'unknown flag key with missing "enabled" field is rejected (else-branch)');
select lives_ok(
  $$update public.remote_config set value = '{"ios":"1.1.0","android":"1.1.0"}'::jsonb
    where key = 'min_app_version'$$,
  'service_role can update a well-formed config (touch trigger fires)');
reset role;

-- rule #1 sanity: a config table never touches the score
select is((select count(*)::int from public.aura_events), 0,
  'remote_config writes create zero aura_events');

select * from finish();
rollback;
