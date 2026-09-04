-- 20260808101452: the webhook's revoke-at-door lookup gets an index. charge.refunded /
-- charge.dispute.created match event_tickets by stripe_payment_id (revokeTicket in
-- stripe-webhook/handlers.ts); the index is partial on the live statuses because a reversal
-- can only ever match a ticket that still admits someone. This test pins the index shape and
-- the revocation semantics it serves: the guarded UPDATE flips a live ticket to 'refunded'
-- and nulls its QR, and a redelivered reversal is a no-op.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_index('public', 'event_tickets', 'event_tickets_by_stripe_payment_id',
  'the reverse-lookup index exists');

-- partial on the two statuses check-in admits — the only rows a reversal can target
select is(
  (select pg_get_expr(i.indpred, i.indrelid)
     from pg_index i
    where i.indexrelid = 'public.event_tickets_by_stripe_payment_id'::regclass),
  $$(status = ANY (ARRAY['paid'::text, 'checked_in'::text]))$$,
  'index is partial on the live statuses (paid, checked_in)'
);

-- fixture: user + paid event + issued ticket (webhook analog, superuser)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','holder@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- The organiser is identity-verified and the row carries settlement_ack_at: #448's
-- events_enforce_paid_gate refuses a paid event without both, on every write path.
update public.profiles set identity_verified = true
  where id = '33333333-3333-3333-3333-333333333333';

insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents, settlement_ack_at)
  values ('e0790000-0000-0000-0000-000000000079','33333333-3333-3333-3333-333333333333',
          'Serata','formazione',true,'https://stream.athanor.test/79', now() + interval '1 day', 1500, now());

insert into public.event_tickets (user_id, event_id, status, stripe_payment_id, qr_token)
  values ('33333333-3333-3333-3333-333333333333','e0790000-0000-0000-0000-000000000079',
          'paid','pi_disputed_79','signed.token.79');

-- the revocation the webhook performs: guarded flip, QR gone
update public.event_tickets
   set status = 'refunded', qr_token = null
 where stripe_payment_id = 'pi_disputed_79'
   and status in ('paid', 'checked_in');

select is(
  (select status from public.event_tickets where stripe_payment_id = 'pi_disputed_79'),
  'refunded',
  'a disputed ticket leaves the door list — check-in admits only paid/checked_in'
);
select is(
  (select qr_token from public.event_tickets where stripe_payment_id = 'pi_disputed_79'),
  null,
  'the QR token is nulled — no valid-looking door pass survives the chargeback'
);

-- a redelivered reversal matches nothing: the status guard makes it a no-op. Proven via the
-- touch trigger — an UPDATE that matches zero rows never fires it, so updated_at stays put.
create temp table t79 as
  select updated_at from public.event_tickets where stripe_payment_id = 'pi_disputed_79';

update public.event_tickets
   set status = 'refunded', qr_token = null
 where stripe_payment_id = 'pi_disputed_79'
   and status in ('paid', 'checked_in');

select is(
  (select updated_at from public.event_tickets where stripe_payment_id = 'pi_disputed_79'),
  (select updated_at from t79),
  'a redelivered reversal is a no-op under the status guard'
);

-- 'refunded' still satisfies the CHECK it has always been part of
select lives_ok(
  $$ update public.event_tickets set status = 'refunded'
      where stripe_payment_id = 'pi_disputed_79' $$,
  'refunded remains a legal event_tickets status'
);

select * from finish();
rollback;
