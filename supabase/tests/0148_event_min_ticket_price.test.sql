begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- #701 — a paid ticket costs at least €5,00 (ruling 2026-09-07). Free stays free: the rule is a
-- BAND, `price_cents = 0 or price_cents >= 500`, and every assertion below asserts both edges of
-- it rather than only the one that moved.
--
-- Three enforcers, none of them redundant, and this file owns the difference between them:
--   * `events_price_min`        — the CHECK. The ONLY guard on an UPDATE, because the trigger is
--                                 BEFORE INSERT. Raises 23514, its own code.
--   * `create_event`            — the RPC arm. Raises 22003 so the composer can map a sentence.
--   * `enforce_paid_event_gate` — the direct-INSERT arm (#448). Same 22003, so a refusal is
--                                 indistinguishable by write path and the catalog needs one
--                                 mapping rather than two.
--
-- The ORDER matters as much as the refusals, and 0125/0147 established why: the floor arm runs
-- FIRST on both paths, so an organiser pricing at €3 without ticking the acknowledgement is told
-- about the price. Being asked to consent to ten percent of a figure the server will refuse is
-- being asked to agree to nothing.
--
-- 0125 owns the acknowledgement arm, 0147 owns the payout arm and the order between those two.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'min_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- Verified AND payable, so every refusal below is the FLOOR and never one of the other three
-- arms wearing its clothes. That is the whole reason this organiser is over-provisioned.
update public.profiles set identity_verified = true
  where id = '11111111-1111-1111-1111-111111111111';

insert into public.payout_accounts (profile_id, stripe_account_id, payouts_enabled)
  values ('11111111-1111-1111-1111-111111111111', 'acct_test_0148', true);

-- ── the constraint itself ─────────────────────────────────────────────────────────────────────
-- Asserted from the catalog, not inferred from a refused write: a behaviour test passes for the
-- wrong reason the moment the trigger happens to refuse first, and on the INSERT path it always
-- does. The exact text is pinned because the BAND is the ruling — a constraint narrowed to
-- `price_cents >= 500` would read as a floor and be a ban on free events.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'events_price_min' and conrelid = 'public.events'::regclass),
  'CHECK (((price_cents = 0) OR (price_cents >= 500)))',
  'events_price_min is the band `0 or >= 500`, not a bare minimum'
);

-- ── the RPC path ──────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok($$
  select public.create_event('Cena sotto soglia','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 499, 'eur', true)
$$, '22003', null, 'one cent under the floor is refused, 22003');

select throws_ok($$
  select public.create_event('Cena da un centesimo','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1, 'eur', true)
$$, '22003', null, 'a token price is refused by the same arm, not by some other one');

-- The boundary, from the legal side. 499 above and 500 here are what make the arm `< 500` rather
-- than `<= 500` or `< 501`; either mutation would take exactly one of this pair with it.
select lives_ok($$
  select public.create_event('Cena al minimo','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 500, 'eur', true)
$$, 'exactly the floor is accepted');

select lives_ok($$
  select public.create_event('Cerchio gratuito','networking',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2)
$$, 'a free event is untouched — the rule is a band, not a minimum');

-- The order. This organiser is verified and payable, so the only two arms in play are the floor
-- and the acknowledgement, and the acknowledgement is deliberately NOT given. 22023 here would
-- mean the composer asks someone to consent to a split of a price that cannot exist.
select throws_ok($$
  select public.create_event('Cena non spuntata','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 300, 'eur', false)
$$, '22003', null, 'the floor refuses BEFORE the acknowledgement arm, not after it');

-- ...and the converse, so the assertion above is about ORDER and not about the ack arm having
-- quietly stopped working: at a legal price the acknowledgement still refuses on its own code.
select throws_ok($$
  select public.create_event('Cena legale non spuntata','benessere',false, now() + interval '10 days',
    'Cascina Cuccagna','Milano', 45.45, 9.2, null, null, null, 1500, 'eur', false)
$$, '22023', null, 'at a legal price the acknowledgement arm is reached, 22023 (#437)');

reset role;

-- ── the direct-INSERT path, which is why it is also a trigger (#448) ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cena diretta sotto soglia','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 499, now())
$$, '22003', null, 'a direct INSERT under the floor is refused with the SAME code the RPC uses');

-- Not 23514. The bare CHECK would also have refused this row, a moment later — the trigger arm
-- exists so the two write paths give the same answer, which is the property #448 bought and the
-- one `event-create.tsx` maps a sentence from.
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cena diretta non spuntata','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 300, null)
$$, '22003', null, 'the trigger refuses the price before the missing acknowledgement, as the RPC does');

select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cena diretta al minimo','benessere',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 500, now())
$$, 'exactly the floor is accepted on the direct path too');

-- The WHEN clause is `coalesce(new.price_cents, 0) > 0`, so a free direct INSERT never reaches the
-- gate at all — and the CHECK admits it separately, which is the half a narrowed constraint loses.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Cerchio diretto','networking',false,
          'Cascina Cuccagna', extensions.st_point(9.2, 45.45)::extensions.geography,
          now() + interval '10 days', 0, null)
$$, 'a free direct INSERT never fires the trigger and passes the CHECK');

reset role;

-- service_role holds `grant all` and bypasses RLS, so a policy-shaped answer would have stopped at
-- the client. A BEFORE INSERT trigger fires for it too, which is what the staging seed depends on.
set local role service_role;
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, stream_url, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Diretta di servizio','musica',true,
          'https://stream.athanor.test/148', now() + interval '10 days', 499, now())
$$, '22003', null, 'service_role is refused too — every write path, which is why it is a trigger');

-- ── the UPDATE path, which ONLY the CHECK covers ──────────────────────────────────────────────
-- events_enforce_paid_gate is BEFORE INSERT. Lowering an existing price is therefore invisible to
-- every arm above, and `events_price_min` is the whole of the enforcement — with its own 23514,
-- which is exactly why the composer does not map that code to price copy: nothing in this app
-- updates a price, and nine other CHECKs on `events` raise it.
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, stream_url, starts_at,
                             price_cents, settlement_ack_at)
  values ('11111111-1111-1111-1111-111111111111','Da ribassare','musica',true,
          'https://stream.athanor.test/148b', now() + interval '11 days', 2000, now())
$$, 'a legally priced row exists to lower');

select throws_ok($$
  update public.events set price_cents = 300 where title = 'Da ribassare'
$$, '23514', null, 'lowering a price under the floor is refused by the CHECK, the only UPDATE guard');

select lives_ok($$
  update public.events set price_cents = 0 where title = 'Da ribassare'
$$, 'a paid event may still be made free — the band admits zero on UPDATE too');

select lives_ok($$
  update public.events set price_cents = 500 where title = 'Da ribassare'
$$, 'and may be repriced to exactly the floor');

reset role;

-- Belt on the whole file: if any lives_ok above had silently written nothing, the counts below
-- would not move. Four accepted RPC/direct rows at the floor or free, plus the repriced one.
select is(
  (select count(*) from public.events
    where organizer_id = '11111111-1111-1111-1111-111111111111'
      and (price_cents = 0 or price_cents >= 500)),
  5::bigint,
  'every accepted write landed, and every landed row satisfies the band'
);

select is(
  (select count(*) from public.events
    where organizer_id = '11111111-1111-1111-1111-111111111111'
      and price_cents > 0 and price_cents < 500),
  0::bigint,
  'nothing under the floor reached the table by any path'
);

select * from finish();
rollback;
