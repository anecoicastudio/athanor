-- #802 — stripe_webhook_events.livemode: schema, backfill semantics, and the client lockout.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_column('public', 'stripe_webhook_events', 'livemode', 'livemode column exists');
select col_type_is('public', 'stripe_webhook_events', 'livemode', 'boolean', 'livemode is boolean');
select col_is_null('public', 'stripe_webhook_events', 'livemode', 'livemode is nullable — NULL = not recorded');
select col_hasnt_default('public', 'stripe_webhook_events', 'livemode', 'livemode has no default — never a guessed mode');

-- The webhook writes the column on insert, and the #725 BEFORE INSERT redaction trigger leaves it
-- alone: it rewrites only `payload`.
insert into public.stripe_webhook_events (event_id, type, livemode, payload)
values
  ('evt_0159_live', 'charge.refunded', true, '{"id":"evt_0159_live","livemode":true}'),
  ('evt_0159_test', 'charge.refunded', false, '{"id":"evt_0159_test","livemode":false}'),
  ('evt_0159_null', 'charge.refunded', null, '{"id":"evt_0159_null"}');

select results_eq(
  $$ select event_id, livemode from public.stripe_webhook_events
      where event_id like 'evt_0159_%' order by event_id $$,
  $$ values ('evt_0159_live'::text, true), ('evt_0159_null', null::boolean), ('evt_0159_test', false) $$,
  'livemode round-trips through the insert trigger unchanged'
);

-- The migration's backfill expression: payload's boolean, and NULL — never a cast failure — when
-- the payload has no boolean livemode. Run against literals so the assertion holds whatever rows
-- the replayed database happens to contain.
select is(
  (select (p ->> 'livemode')::boolean from (values ('{"livemode":false}'::jsonb)) v(p)
    where jsonb_typeof(p -> 'livemode') = 'boolean'),
  false,
  'backfill reads a boolean livemode from the payload'
);
select is_empty(
  $$ select 1 from (values ('{"livemode":"false"}'::jsonb), ('{}'::jsonb)) v(p)
      where jsonb_typeof(p -> 'livemode') = 'boolean' $$,
  'backfill skips a payload without a boolean livemode'
);

-- Client roles reach the column no more than the rest of the ledger: not at all (42501).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a159', 'wh159@test.dev');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000a159","role":"authenticated"}';
select throws_ok(
  $$ select livemode from public.stripe_webhook_events $$,
  '42501', null, 'authenticated cannot read livemode'
);
reset role;
set local role anon;
select throws_ok(
  $$ update public.stripe_webhook_events set livemode = true $$,
  '42501', null, 'anon cannot write livemode'
);
reset role;

select * from finish();
rollback;
