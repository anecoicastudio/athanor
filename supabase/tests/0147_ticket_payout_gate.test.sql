begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

-- #104 — a paid event needs an organiser who can actually be paid.
--
-- The ticket Checkout Session now carries transfer_data.destination = the organiser's connected
-- account plus an application_fee_amount, so an organiser with no usable account is not a
-- settlement inconvenience any more: the Session cannot be constructed at all, and Stripe would
-- say so only AFTER claim_event_seat had held a seat. The refusal therefore moves to creation.
--
-- Same shape as 0125 (#437's acknowledgement) and for the same reason: two write paths, so two
-- gates, so both are asserted. 0125 owns the acknowledgement arm and the identity arm; this file
-- owns the payout arm and the ORDER between them.

-- Four organisers, so that every branch of the gate is reachable:
--   A  verified, payout row, payouts_enabled          → publishes
--   B  verified, NO payout row at all                 → the coalesce case, the one that fails open
--   C  verified, payout row with payouts_enabled false → the revocation case
--   D  UNVERIFIED, payout row enabled                 → proves identity still refuses first
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pay_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pay_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'pay_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'pay_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

update public.profiles set identity_verified = true
  where id in ('11111111-1111-1111-1111-111111111111',
               '22222222-2222-2222-2222-222222222222',
               '33333333-3333-3333-3333-333333333333');

insert into public.payout_accounts (profile_id, stripe_account_id, charges_enabled, payouts_enabled)
values
  ('11111111-1111-1111-1111-111111111111', 'acct_test_0147_a', false, true),
  ('33333333-3333-3333-3333-333333333333', 'acct_test_0147_c', false, false),
  ('44444444-4444-4444-4444-444444444444', 'acct_test_0147_d', false, true);

-- ── the helper reads the flag, and fails CLOSED on a missing row ──────────────────────────────
select has_function('public', 'has_payouts_enabled', array['uuid'],
  'has_payouts_enabled(uuid) exists');

select ok(public.has_payouts_enabled('11111111-1111-1111-1111-111111111111'),
  'true for an organiser whose account can receive payouts');

-- The load-bearing one. payout_accounts is select-own and an organiser who never onboarded has NO
-- ROW, so the scalar subquery is NULL. Without the coalesce the callers read `if not null then
-- raise`, which never fires: the gate would fail OPEN on exactly the case it exists to catch.
select ok(not public.has_payouts_enabled('22222222-2222-2222-2222-222222222222'),
  'false — not null — for an organiser with no payout row at all');

select ok(not public.has_payouts_enabled('33333333-3333-3333-3333-333333333333'),
  'false once Stripe has revoked the capability (payouts_enabled false)');

-- ── the definer discipline, asserted from the catalog rather than trusted ──────────────────────
-- Both helpers read another member's row, so a leaked search_path or a lost revoke is the whole
-- risk. 0121 states the grant rules schema-wide; these are the local statements.
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_payouts_enabled'),
  true,
  'has_payouts_enabled is SECURITY DEFINER — an invoker body could not read a stranger''s row'
);

select ok(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'has_payouts_enabled')
  @> array['search_path=""'],
  'has_payouts_enabled locks search_path to the empty string'
);

select ok(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'organizer_payout_destination')
  @> array['search_path=""'],
  'organizer_payout_destination locks search_path to the empty string'
);

select ok(not has_function_privilege('anon', 'public.has_payouts_enabled(uuid)', 'EXECUTE'),
  'anon cannot execute has_payouts_enabled');
select ok(has_function_privilege('authenticated', 'public.has_payouts_enabled(uuid)', 'EXECUTE'),
  'authenticated executes has_payouts_enabled');
-- The is_identity_verified precedent (20260815164809:228): a write that fires the trigger under the
-- service key must fail on the GATE, not with a confusing 42501 on the helper behind it.
select ok(has_function_privilege('service_role', 'public.has_payouts_enabled(uuid)', 'EXECUTE'),
  'service_role executes has_payouts_enabled, so the trigger works on every write path');
select ok(not has_function_privilege('anon', 'public.organizer_payout_destination(uuid)', 'EXECUTE'),
  'anon cannot execute organizer_payout_destination');
select ok(has_function_privilege('authenticated', 'public.organizer_payout_destination(uuid)', 'EXECUTE'),
  'authenticated executes organizer_payout_destination');

-- ── the RPC path ──────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($$
  select public.create_event('Cerchio gratuito','networking',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2)
$$, 'a free event is untouched by the payout gate');

select lives_ok($$
  select public.create_event('Cena pagabile','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500, 'eur', true)
$$, 'a paid event by a payable organiser is created');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  select public.create_event('Cena senza conto','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500, 'eur', true)
$$, '55000', null, 'a paid event with no payout account is refused, 55000');

select lives_ok($$
  select public.create_event('Cerchio senza conto','networking',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2)
$$, 'the same organiser still publishes a FREE event — a gate, not a wall');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  select public.create_event('Cena revocata','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500, 'eur', true)
$$, '55000', null, 'a revoked capability refuses just as hard as a missing account');

-- The ORDER, which is the reason the two arms carry different errcodes: D has a perfectly good
-- payout account and no verified identity. If the payout arm ran first, the client would be told
-- to finish getting paid when what it must do is verify.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$
  select public.create_event('Cena non verificata','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500, 'eur', true)
$$, '42501', null, 'identity still refuses first — a payable but unverified organiser gets 42501');

reset role;

-- ── the direct-INSERT path, which is why it is also a trigger (#448) ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('22222222-2222-2222-2222-222222222222','Cena diretta senza conto','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 1500, now())
$$, '55000', null, 'a paid direct INSERT with no payout account is refused, exactly as the RPC refuses it');

-- The WHEN clause is `price_cents > 0`, so a free direct INSERT never reaches the gate at all.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('22222222-2222-2222-2222-222222222222','Cerchio diretto','networking',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 0, null)
$$, 'a free direct INSERT never fires the trigger');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cena diretta pagabile','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 1500, now())
$$, 'a payable organiser still publishes a paid event directly — the arm is not a wall');

reset role;

-- service_role holds `grant all` and bypasses RLS, so a policy-shaped answer would have stopped at
-- the client. A BEFORE INSERT trigger fires for it too, which is what the staging seed depends on.
set local role service_role;
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, stream_url, starts_at,
                             price_cents, settlement_ack_at)
  values ('33333333-3333-3333-3333-333333333333','Diretta revocata','musica',true,
          'https://stream.athanor.test/147', now() + interval '10 days', 1500, now())
$$, '55000', null, 'service_role is refused too — every write path, which is why it is a trigger');
reset role;

-- ── the destination the Checkout Session is built from ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Read as B, who is NOT the organiser: that is the whole point of the definer function, since
-- payout_accounts is select-own and the buyer minting a session is never the organiser.
select is(
  public.organizer_payout_destination(
    (select id from public.events where title = 'Cena pagabile')),
  'acct_test_0147_a',
  'a buyer resolves the organiser''s destination account without being able to read the row'
);

select is(
  public.organizer_payout_destination(
    (select id from public.events where title = 'Cerchio gratuito')),
  null,
  'a free event has no destination — it never reaches Stripe'
);

select is(
  public.organizer_payout_destination('00000000-0000-0000-0000-0000000000ff'),
  null,
  'an unknown event id resolves to null rather than raising'
);

-- The buyer must not reach the account id row-by-row either: the definer function is the only
-- route. Asserted as EMPTY rather than as a raise, because that is what actually happens — the
-- table-level SELECT grant is real and payout_accounts_select_own filters the row away, so a
-- throws_ok here would be asserting a refusal the database never makes. The privilege half is the
-- line below: a client may read its own row and may not write any, and 0121 pins that catalog-wide.
select is_empty($$
  select stripe_account_id from public.payout_accounts
   where profile_id = '11111111-1111-1111-1111-111111111111'
$$, 'a buyer sees no row for the organiser''s payout account, only the definer function''s answer');

select ok(
  has_table_privilege('authenticated', 'public.payout_accounts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payout_accounts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.payout_accounts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.payout_accounts', 'DELETE'),
  'clients read their own payout row and write none of it — the flags are the webhook''s (rule #6)'
);

reset role;

-- A capability Stripe revokes after the event was created must close the destination immediately —
-- the creation gate cannot cover this, which is why create-ticket-checkout re-checks at purchase.
update public.payout_accounts set payouts_enabled = false
  where profile_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.organizer_payout_destination(
    (select id from public.events where title = 'Cena pagabile')),
  null,
  'a revoked capability closes the destination on an event that already exists'
);
reset role;

update public.payout_accounts set payouts_enabled = true
  where profile_id = '11111111-1111-1111-1111-111111111111';
update public.events set deleted_at = now() where title = 'Cena pagabile';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.organizer_payout_destination(
    (select id from public.events where title = 'Cena pagabile')),
  null,
  'a deleted event has no destination, so a stale link cannot mint a session'
);
reset role;

select * from finish();
rollback;
