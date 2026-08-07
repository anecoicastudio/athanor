-- claimed_at lease column: schema + service-role-only writes stay locked down.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_column('public', 'stripe_webhook_events', 'claimed_at', 'claimed_at column exists');
select col_type_is('public', 'stripe_webhook_events', 'claimed_at', 'timestamp with time zone', 'claimed_at is timestamptz');

-- RLS stays enabled with ZERO policies (engine-only table).
select ok(
  (select relrowsecurity from pg_class where oid = 'public.stripe_webhook_events'::regclass),
  'RLS enabled on stripe_webhook_events'
);
select policies_are('public', 'stripe_webhook_events', array[]::text[], 'no policies — service_role only');

-- A member cannot claim or complete events (privilege revoked, 42501).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a071', 'wh71@test.dev');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000a071","role":"authenticated"}';
select throws_ok(
  $$ update public.stripe_webhook_events set claimed_at = now() where event_id = 'evt_x' $$,
  '42501', null, 'authenticated cannot write claimed_at'
);
reset role;
set local role anon;
select throws_ok(
  $$ select claimed_at from public.stripe_webhook_events $$,
  '42501', null, 'anon cannot read the ledger'
);
reset role;

select * from finish();
rollback;
