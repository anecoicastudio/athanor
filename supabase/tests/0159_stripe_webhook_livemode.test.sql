-- #802 — stripe_webhook_events.livemode: a STORED GENERATED column over payload, and the client
-- lockout. The inserts below go through the real column expression and the real #725 BEFORE
-- INSERT redaction trigger, so a change to either shows up here.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public', 'stripe_webhook_events', 'livemode', 'livemode column exists');
select col_type_is('public', 'stripe_webhook_events', 'livemode', 'boolean', 'livemode is boolean');
select is(
  (select attgenerated::text from pg_attribute
    where attrelid = 'public.stripe_webhook_events'::regclass and attname = 'livemode'),
  's',
  'livemode is a STORED GENERATED column — nothing writes it, so nothing can leave it out'
);

-- The webhook writes event_id, type and payload only; the mode is derived from payload.
insert into public.stripe_webhook_events (event_id, type, payload)
values
  ('evt_0159_live', 'charge.refunded', '{"id":"evt_0159_live","livemode":true}'),
  ('evt_0159_test', 'charge.refunded', '{"id":"evt_0159_test","livemode":false}'),
  ('evt_0159_none', 'charge.refunded', '{"id":"evt_0159_none"}'),
  ('evt_0159_str',  'charge.refunded', '{"id":"evt_0159_str","livemode":"false"}');

select results_eq(
  $$ select event_id, livemode from public.stripe_webhook_events
      where event_id like 'evt_0159_%' order by event_id $$,
  $$ values ('evt_0159_live'::text, true),
            ('evt_0159_none', null::boolean),
            ('evt_0159_str', null::boolean),
            ('evt_0159_test', false) $$,
  'livemode is payload''s boolean livemode, NULL when there is none — never a guess'
);

-- An erasure rewrites payload (#725); livemode is not an identity key, so it survives.
update public.stripe_webhook_events
   set payload = public.gdpr_redact_stripe_identity(payload)
 where event_id = 'evt_0159_test';
select is(
  (select livemode from public.stripe_webhook_events where event_id = 'evt_0159_test'),
  false,
  'livemode survives a GDPR payload redaction'
);

select throws_ok(
  $$ insert into public.stripe_webhook_events (event_id, type, livemode, payload)
     values ('evt_0159_direct', 'charge.refunded', true, '{}') $$,
  '428C9', null, 'livemode cannot be written directly'
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
  $$ select livemode from public.stripe_webhook_events $$,
  '42501', null, 'anon cannot read livemode'
);
reset role;

select * from finish();
rollback;
