begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

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
  not has_function_privilege('anon', 'public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean, text)', 'EXECUTE'),
  'anon cannot execute create_event'
);
select ok(
  has_function_privilege('authenticated', 'public.create_event(text, public.event_category, boolean, timestamptz, text, text, double precision, double precision, text, timestamptz, integer, bigint, text, boolean, text)', 'EXECUTE'),
  'authenticated executes create_event'
);
-- And exactly one create_event: an overload pair is what CREATE OR REPLACE would have produced,
-- and PostgREST cannot resolve a 13-named-arg call against two candidates.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event'),
  1,
  'create_event has exactly one signature — each widening drops its predecessor, never shadows it'
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

-- ── the gate that closes it, and the privileges that shaped it ────────────────────────────────
-- The migration's column comment says settlement_ack_at is «never client-supplied». That was true
-- of create_event and, on the INSERT path, false as a statement about the column.
--
-- #446 narrowed half of it. `authenticated` no longer holds table-level insert/update on events:
-- UPDATE is revoked outright and events_update_own is dropped, so a stamped row can no longer be
-- rewritten by the organiser who owns it. INSERT is column-scoped to exactly the fourteen columns
-- create_event writes — which is where the narrowing HAD to stop, because create_event is SECURITY
-- INVOKER and therefore needs price_cents and settlement_ack_at in the caller's grant to write
-- them itself.
--
-- #448 closes the remainder with a BEFORE INSERT trigger rather than with a grant, because
-- «price_cents > 0 requires an acknowledgement and a verified identity» is a predicate over VALUES
-- and no privilege can express one. The assertions below say which half each layer holds: the
-- grants still bound which COLUMNS a statement may name, and the trigger now bounds the VALUES —
-- on every write path, service_role included, which is more than an RLS policy could have reached.
-- supabase/MIGRATIONS-ERRATA.md carries the amended correction.
select ok(
  not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'authenticated holds no UPDATE on events (#446) — a stamped settlement_ack_at cannot be rewritten'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'INSERT'),
  'authenticated holds no TABLE-level INSERT on events (#446) — the grant is column-scoped'
);
select ok(
  has_column_privilege('authenticated', 'public.events', 'settlement_ack_at', 'INSERT'),
  'settlement_ack_at stays insertable — create_event is SECURITY INVOKER and writes it as the caller'
);

-- ── the trigger's shape is itself part of the claim ───────────────────────────────────────────
select has_trigger('public', 'events', 'events_enforce_paid_gate',
  'the paid-event gate is attached to events (#448)');
-- tgtype bits: ROW 1 | BEFORE 2 | INSERT 4. Exactly 7 — BEFORE INSERT, FOR EACH ROW, nothing else.
-- Creation-time by decision, not by omission: `authenticated` holds no UPDATE for an OR UPDATE arm
-- to gate (asserted three above), and such an arm would instead fire against the service-role and
-- pg_cron writers that legitimately update unrelated columns on rows predating the trigger — the
-- hourly staging refresh re-stamps two paid events that way. If an event-edit feature ever grants
-- UPDATE back, this number is what tells it the arm is missing.
select is(
  (select g.tgtype::int from pg_trigger g
    where g.tgrelid = 'public.events'::regclass and g.tgname = 'events_enforce_paid_gate'),
  7,
  'events_enforce_paid_gate is BEFORE INSERT FOR EACH ROW — creation-time only'
);
-- 0121 holds this catalog-wide as a rule over every trigger function; this is the local statement.
select ok(
  not has_function_privilege('anon', 'public.enforce_paid_event_gate()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enforce_paid_event_gate()', 'EXECUTE'),
  'the gate function grants EXECUTE to neither anon nor authenticated (#409)'
);

-- ── the residual, refused ─────────────────────────────────────────────────────────────────────
-- Still organiser B, unverified, whose RPC call was refused two assertions above. Every column
-- named here is one create_event names too, so the privilege layer admits the statement — and the
-- trigger refuses it anyway, with create_event's own errcode and message. Until #448 this was a
-- passing lives_ok, and #448 is the change that turns it round.
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('22222222-2222-2222-2222-222222222222','Bottega, per direttissima','creativi',false,
          'Officina', extensions.st_point(9.19, 45.46)::extensions.geography,
          now() + interval '10 days', 2000, now())
$$, '42501', null,
   'a direct INSERT by an unverified organiser is refused now, exactly as the RPC refuses it');

-- The free half is untouched: the trigger's WHEN clause tests price_cents > 0, so an unverified
-- organiser still publishes a free event. Without this the gate would read as a ban on B.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents)
  values ('22222222-2222-2222-2222-222222222222','Bottega a porte aperte','creativi',false,
          'Officina', extensions.st_point(9.19, 45.46)::extensions.geography,
          now() + interval '10 days', 0)
$$, 'a free event by an unverified organiser is untouched — the gate fires only above zero');

-- ── the acknowledgement arm, on the direct path ───────────────────────────────────────────────
-- Organiser A is verified, so A clears the identity arm and only the acknowledgement can refuse.
-- Through the RPC the column is stamped from now() and can never be null by the time a trigger
-- sees it; on this path its absence IS the missing acknowledgement, and 22023 is what create_event
-- raises for that. Both arms therefore reach the direct path, in create_event's own order.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents)
  values ('11111111-1111-1111-1111-111111111111','Cena senza firma','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 1500)
$$, '22023', null,
   'a paid direct INSERT with no acknowledgement is refused, exactly as the RPC refuses it');

-- A gate, not a wall. A trigger that refused every paid INSERT would satisfy every assertion above
-- and still be wrong; this is the one that fails if the WHEN clause or either arm inverts.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cena con firma','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 1500, now())
$$, 'a verified organiser who acknowledges still publishes a paid event');

-- The privilege half, on the same shape: fee_pct is not in the grant, so the statement is refused
-- at the PRIVILEGE layer before a row is ever formed. Run as verified A WITH the acknowledgement on
-- purpose — as unverified B this row would raise 42501 through the trigger too, and would then pass
-- for the wrong reason the moment the column narrowing was reverted.
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at, fee_pct)
  values ('11111111-1111-1111-1111-111111111111','Cena a tariffa propria','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 1500, now(), 0.00)
$$, '42501', null, 'an organiser cannot set their own fee_pct, on their own row, on the way in');

reset role;

-- ── every write path, which is why it is a trigger ────────────────────────────────────────────
-- service_role holds `grant all` and bypasses RLS, so a policy-shaped answer would have stopped at
-- the client. A BEFORE INSERT trigger fires for it too. This is not hypothetical: the staging seed
-- inserts its paid events exactly this way, and that is where #448's fixture churn came from.
set local role service_role;
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, stream_url, starts_at,
                             price_cents, settlement_ack_at)
  values ('22222222-2222-2222-2222-222222222222','Diretta, per direttissima','musica',true,
          'https://stream.athanor.test/448', now() + interval '10 days', 2000, now())
$$, '42501', null, 'service_role does not escape the gate — the trigger fires on every write path');
reset role;

select * from finish();
rollback;
