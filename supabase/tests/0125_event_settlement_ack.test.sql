begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- #437 — organisers are told, before they list a paid event, that settlement is manual and on what
-- cadence, and create_event holds them to it. #104's deferral of Stripe Connect was granted on that
-- disclosure existing; the composer cannot be where it is enforced, because the composer's gate is
-- one client-side `if` that whoever opens the paid path deletes in the same edit.
--
-- Two users: A (identity-verified, so A can reach the acknowledgement check) and B (unverified, the
-- PRD §4.13 arm folded into the same replace). The handle_new_user trigger creates both profiles;
-- identity_verified is flipped here as the table owner, which is the M9 service-role webhook's
-- write path — a client cannot write that column at all (0042, 0059 assert that).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'org_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'org_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

update public.profiles set identity_verified = true
  where id = '11111111-1111-1111-1111-111111111111';

-- ── the column ────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'events', 'settlement_ack_at', 'events.settlement_ack_at exists');
select col_type_is('public', 'events', 'settlement_ack_at', 'timestamp with time zone',
  'settlement_ack_at is timestamptz');
select col_is_null('public', 'events', 'settlement_ack_at',
  'settlement_ack_at is nullable — a free event has nothing to acknowledge');

-- Not anon-readable. `authenticated` holds events at table level, `anon` holds a COLUMN LIST
-- (20260812054134), so the new column is closed to anon by construction. Asserted as a PRIVILEGE,
-- never as a read: a read that returns nothing passes for the wrong reason the moment RLS happens
-- to swallow it.
select ok(
  not has_column_privilege('anon', 'public.events', 'settlement_ack_at', 'SELECT'),
  'anon cannot select settlement_ack_at — an acknowledgement is not public event data'
);
select ok(
  has_column_privilege('authenticated', 'public.events', 'settlement_ack_at', 'SELECT'),
  'authenticated reads settlement_ack_at through the table-level grant'
);

-- ── the function's execute surface survived the drop + create ─────────────────────────────────
-- A 14th parameter forced drop-and-create rather than CREATE OR REPLACE, and dropping discards the
-- ACL. If the migration forgot to re-issue the pair, EXECUTE falls back to the pg_default_acl 'f'
-- row and lands on PUBLIC + anon. 0121 catches it catalog-wide; this is the local statement.
select ok(
  not has_function_privilege('anon', 'public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean)', 'EXECUTE'),
  'anon cannot execute create_event'
);
select ok(
  has_function_privilege('authenticated', 'public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean)', 'EXECUTE'),
  'authenticated executes create_event'
);
-- And exactly one create_event: an overload pair is what CREATE OR REPLACE would have produced,
-- and PostgREST cannot resolve a 13-named-arg call against two candidates.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event'),
  1,
  'create_event has exactly one signature — the 13-arg overload was dropped, not shadowed'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ── a free event is untouched by any of this ──────────────────────────────────────────────────
select lives_ok($$
  select public.create_event('Cerchio di apertura','networking',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2)
$$, 'a free event needs no acknowledgement');

select is(
  (select settlement_ack_at from public.events where title = 'Cerchio di apertura'),
  null,
  'a free event stamps no settlement_ack_at'
);

-- ── a paid event without the acknowledgement is refused ───────────────────────────────────────
select throws_ok($$
  select public.create_event('Cena condivisa','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500)
$$, '22023', null, 'a paid event with no acknowledgement is refused');

-- ── a paid event with it is stamped from now(), server-side ───────────────────────────────────
select lives_ok($$
  select public.create_event('Cena dei Fondatori','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 2000, 'eur', true)
$$, 'a paid event with the acknowledgement is created');

select ok(
  (select settlement_ack_at is not null and settlement_ack_at <= now()
     from public.events where title = 'Cena dei Fondatori'),
  'settlement_ack_at is stamped from server time, not supplied by the caller'
);

-- ── PRD §4.13, folded into the same replace: an unverified organiser cannot list a paid event ──
-- Checkout already fails closed on this (create-ticket-checkout/logic.ts), so it was never a money
-- hole — but until now it was a product rule trusted to event-create.tsx.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  select public.create_event('Bottega aperta','creativi',false, now() + interval '10 days',
    'Officina','Milano', 45.46, 9.19, null, null, null, 2000, 'eur', true)
$$, '42501', null, 'an unverified organiser cannot list a paid event, acknowledgement or not');

reset role;

select * from finish();
rollback;
