-- #725 — the webhook ledger loses the identity an erasure removes, and keeps the dedupe gate.
--
-- `stripe_webhook_events.payload` stores the whole Stripe event, so an Article 17 request that
-- emptied `event_tickets`, `circle_memberships` and `fund_contributions` left the same person's
-- email, name, address and `metadata.profile_id` sitting in the JSON beside them. Marco's ruling
-- (#725, 2026-09-09): redact, never delete, at erasure time. The 2026-09-11 amendment added the
-- second arm — see §5 — after `erasure-job` turned out to provoke a webhook of its own.
--
-- Four claims, each one a thing that was false before 20260912070533:
--
--   1. THE SWEEP REACHES EVERY SHAPE. `gdpr_erase_payment_footprint` redacts events that name the
--      member three different ways: our own `metadata.profile_id`, the Stripe customer id of the
--      membership it is pseudonymising in the same transaction, and the payment intent of one of
--      their tickets. Invoices carry no metadata of ours, so without the customer arm they would
--      stay legible; refunds carry neither, so without the payment-intent arm they would too.
--   2. WHAT ARRIVES AFTER THE CASCADE IS CAUGHT ON THE WAY IN. The erasure cancels the Circle
--      subscription (erasure-job/logic.ts:447-526) and Stripe answers with
--      `customer.subscription.deleted` AFTER the sweep has run — «the FIRST event this endpoint
--      sees after an erasure» (stripe-webhook/handlers.ts:494). §5 inserts exactly that event and
--      asserts it lands redacted.
--   3. THE MONEY SURVIVES THE REDACTION. Amounts, currencies, statuses and every Stripe id stay
--      verbatim — the ledger is still the forensic record rule 6 keeps.
--   4. THE DEDUPE GATE IS UNCHANGED. A re-delivery of a redacted event is still a no-op (ON
--      CONFLICT DO NOTHING cannot rewrite the payload back), `processed_at` still answers the
--      replay, and a redacted row that was never processed can still be claimed and processed.
--
-- The edge half of claim 4 — that the upsert really passes `ignoreDuplicates: true` — is pinned
-- in stripe-webhook/handlers.test.ts, because the flag lives in TypeScript. This file owns what
-- the database owns.

begin;

create extension if not exists pgtap with schema extensions;

select plan(67);

-- ── 1. the redactor and its key list: shape, posture, privileges ─────────────────────────

select has_function('public', 'gdpr_stripe_identity_keys', array[]::text[],
  'gdpr_stripe_identity_keys exists');
select has_function('public', 'gdpr_redact_stripe_identity', array['jsonb'],
  'gdpr_redact_stripe_identity exists');
select has_function('public', 'stripe_webhook_event_redact_erased', array[]::text[],
  'the BEFORE INSERT trigger function exists');

-- IMMUTABLE is not decoration on these two: the redactor is called from an UPDATE over the
-- ledger and from a row trigger, and the key list has to inline into it.
select is(
  (select provolatile from pg_proc where oid = 'public.gdpr_stripe_identity_keys()'::regprocedure),
  'i'::"char", 'the key list is IMMUTABLE');
select is(
  (select provolatile from pg_proc where oid = 'public.gdpr_redact_stripe_identity(jsonb)'::regprocedure),
  'i'::"char", 'the redactor is IMMUTABLE');

select is(
  (select proconfig from pg_proc where oid = 'public.gdpr_stripe_identity_keys()'::regprocedure),
  array['search_path=""'], 'the key list locks search_path to empty');
select is(
  (select proconfig from pg_proc where oid = 'public.gdpr_redact_stripe_identity(jsonb)'::regprocedure),
  array['search_path=""'], 'the redactor locks search_path to empty');
select is(
  (select proconfig from pg_proc where oid = 'public.stripe_webhook_event_redact_erased()'::regprocedure),
  array['search_path=""'], 'the trigger function locks search_path to empty');

-- INVOKER throughout, following the gdpr_erase_payment_footprint precedent: the only writer of
-- this table is the webhook's service-role client, which already holds every table these read.
select ok(
  (select not p.prosecdef from pg_proc p
    where p.oid = 'public.stripe_webhook_event_redact_erased()'::regprocedure),
  'the trigger function is SECURITY INVOKER — service_role already holds what it reads');

-- PostgreSQL grants EXECUTE to PUBLIC on every new function and the pg_default_acl 'f' row adds
-- anon and authenticated (#409). These are what the migration's revokes buy.
select ok(not has_function_privilege('anon', 'public.gdpr_redact_stripe_identity(jsonb)', 'execute'),
  'anon cannot rewrite ledger payloads');
select ok(not has_function_privilege('authenticated', 'public.gdpr_redact_stripe_identity(jsonb)', 'execute'),
  'authenticated cannot either');
select ok(has_function_privilege('service_role', 'public.gdpr_redact_stripe_identity(jsonb)', 'execute'),
  'service_role — the erasure job''s client — can');
select ok(not has_function_privilege('anon', 'public.gdpr_stripe_identity_keys()', 'execute'),
  'anon cannot read the key list');
select ok(not has_function_privilege('authenticated', 'public.gdpr_stripe_identity_keys()', 'execute'),
  'authenticated cannot either');
select ok(has_function_privilege('service_role', 'public.gdpr_stripe_identity_keys()', 'execute'),
  'service_role can — the redactor calls it as the job');

-- A trigger function is invoked by the trigger, never called by a role (0121 asserts this as a
-- rule over the whole schema; asserted here by name too, because this one reads profiles).
select ok(not has_function_privilege('anon', 'public.stripe_webhook_event_redact_erased()', 'execute'),
  'anon cannot call the trigger function directly');
select ok(not has_function_privilege('authenticated', 'public.stripe_webhook_event_redact_erased()', 'execute'),
  'authenticated cannot either');

-- ── 2. the key list, pinned ──────────────────────────────────────────────────────────────
-- Widening it is a decision someone has to type. `name` staying OUT is half the point: it is
-- also a product's name and a price's nickname, and nulling those would erase what was paid for.
select bag_eq(
  $$ select unnest(public.gdpr_stripe_identity_keys()) $$,
  $$ values ('address'::text), ('billing_details'), ('business_profile'), ('client_reference_id'),
            ('company'), ('customer_address'), ('customer_details'), ('customer_email'),
            ('customer_name'), ('customer_phone'), ('email'), ('individual'), ('phone'),
            ('profile_id'), ('receipt_email'), ('shipping'), ('shipping_details'),
            ('verified_outputs') $$,
  'the identity key list is exactly these eighteen');
select ok(not ('name' = any (public.gdpr_stripe_identity_keys())),
  '«name» is NOT redacted — it is also the product''s name, which is a money fact');

-- ── 3. the indexes the sweep is written against ──────────────────────────────────────────
select has_index('public', 'stripe_webhook_events', 'stripe_webhook_events_payload_profile_id_idx',
  'the metadata.profile_id expression is indexed');
select has_index('public', 'stripe_webhook_events', 'stripe_webhook_events_payload_customer_idx',
  'the customer id expression is indexed');
select has_index('public', 'stripe_webhook_events', 'stripe_webhook_events_payload_payment_intent_idx',
  'the payment intent expression is indexed');

-- Partial on the expression itself, which is what lets a redacted row LEAVE the index: after the
-- redaction the path is JSON null, so it stops matching `is not null`.
select ok(
  (select indexdef like '%WHERE ((payload #>> %) IS NOT NULL)%'
     from pg_indexes
    where schemaname = 'public' and indexname = 'stripe_webhook_events_payload_profile_id_idx'),
  'and it is partial — a redacted row drops out of it rather than sitting in it forever');

-- ── 4. the trigger is wired to the table ─────────────────────────────────────────────────
select has_trigger('public', 'stripe_webhook_events', 'stripe_webhook_events_redact_erased',
  'the ledger carries the redaction trigger');
select trigger_is('public', 'stripe_webhook_events', 'stripe_webhook_events_redact_erased',
  'public', 'stripe_webhook_event_redact_erased',
  'and it runs the redaction function');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.stripe_webhook_events'::regclass
      and tgname = 'stripe_webhook_events_redact_erased'
      and tgtype & 2 = 2      -- BEFORE
      and tgtype & 4 = 4),    -- INSERT
  1, 'BEFORE INSERT — it rewrites the row on the way in, never after the fact');

-- ── 5. the redactor itself, before any fixture ───────────────────────────────────────────

select is(
  public.gdpr_redact_stripe_identity(
    '{"data":{"object":{"customer_details":{"email":"a@test.athanor","name":"A","address":{"city":"Milano"}},
                        "amount_total":2500,"currency":"eur","customer":"cus_x","id":"cs_x"}}}'::jsonb)
    #> '{data,object,customer_details}',
  'null'::jsonb,
  'customer_details is nulled, not removed — the shape says «redacted», not «never sent»');
select is(
  public.gdpr_redact_stripe_identity(
    '{"data":{"object":{"customer_details":{"email":"a@test.athanor"},"amount_total":2500,
                        "currency":"eur","customer":"cus_x","id":"cs_x"}}}'::jsonb)
    #> '{data,object}',
  '{"customer_details":null,"amount_total":2500,"currency":"eur","customer":"cus_x","id":"cs_x"}'::jsonb,
  'and everything else — amount, currency, the Stripe ids — is kept verbatim');

-- Invoices nest the subscription metadata under `parent.subscription_details` on the pinned API
-- version (handlers.ts:599-606). A path-by-path redaction would have missed it; a key list at any
-- depth does not.
select is(
  public.gdpr_redact_stripe_identity(
    '{"data":{"object":{"parent":{"subscription_details":{"metadata":{"profile_id":"49000000-0000-0000-0000-0000000000aa","kind":"subscription"}}}}}}'::jsonb)
    #> '{data,object,parent,subscription_details,metadata}',
  '{"profile_id":null,"kind":"subscription"}'::jsonb,
  'profile_id is nulled at ANY depth, and the sibling routing key survives');

select is(
  public.gdpr_redact_stripe_identity(
    '{"data":{"object":{"charges":{"data":[{"billing_details":{"email":"a@test.athanor"},"amount":2500}]}}}}'::jsonb)
    #> '{data,object,charges,data,0}',
  '{"billing_details":null,"amount":2500}'::jsonb,
  'arrays are walked — a charge nested under payment_intent.charges.data is reached');

select is(
  public.gdpr_redact_stripe_identity(
    public.gdpr_redact_stripe_identity('{"data":{"object":{"email":"a@test.athanor","id":"acct_x"}}}'::jsonb)),
  public.gdpr_redact_stripe_identity('{"data":{"object":{"email":"a@test.athanor","id":"acct_x"}}}'::jsonb),
  'redacting twice changes nothing — the erasure job re-drives requests by hand (R-8 §7.5)');

select is(
  public.gdpr_redact_stripe_identity(
    '{"data":{"object":{"lines":{"data":[{"description":"Athanor Circle","price":{"nickname":"monthly"},"name":"Athanor Circle"}]}}}}'::jsonb)
    #>> '{data,object,lines,data,0,name}',
  'Athanor Circle',
  'what was paid for survives — «name» on a line item is a product, not a person');

-- ── 6. fixture: two members, one shared event, one ledger ────────────────────────────────
-- A (…aa) is erased. B (…bb) is not, and every assertion about A is paired with one about B:
-- one member's erasure is one member's.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'a725@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'b725@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-0000-0000-0000000000cc',
   'authenticated', 'authenticated', 'c725@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at, price_cents)
values ('52000000-0000-0000-0000-0000000000e1', '52000000-0000-0000-0000-0000000000cc',
        'Cerchio di prova', 'networking', false, 'Cascina Cuccagna',
        extensions.st_point(9.2, 45.45)::extensions.geography, now() + interval '10 days', 0);

insert into public.event_tickets (id, user_id, event_id, stripe_payment_id, qr_token, status)
values
  ('52000000-0000-0000-0000-000000000011', '52000000-0000-0000-0000-0000000000aa',
   '52000000-0000-0000-0000-0000000000e1', 'pi_725_a', 'qr_725_a', 'paid'),
  ('52000000-0000-0000-0000-000000000012', '52000000-0000-0000-0000-0000000000bb',
   '52000000-0000-0000-0000-0000000000e1', 'pi_725_b', 'qr_725_b', 'paid');

insert into public.circle_memberships (profile_id, stripe_customer_id, stripe_subscription_id, plan, status)
values
  ('52000000-0000-0000-0000-0000000000aa', 'cus_725_a', 'sub_725_a', 'monthly', 'active'),
  ('52000000-0000-0000-0000-0000000000bb', 'cus_725_b', 'sub_725_b', 'annual', 'active');

-- A fund contribution of A's, already tombstoned and stamped: the state the fund reach (step 3)
-- leaves behind BEFORE the payment reach (step 3c) runs. It is why the contribution arm lives in
-- the trigger rather than in the sweep — by then nothing links the row to A.
insert into public.fund_editions
  (id, target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters,
   min_candidacies, split_pct, cost_fee_statement, equity_declared)
values ('52000000-0000-0000-0000-0000000000ed', now() - interval '1 year', 5000000, 'closed',
        'realized', 100000, 5, 3, 10, 'fixture costs statement', 'none');

insert into public.fund_contributions
  (id, edition_id, profile_id, amount_cents, stripe_checkout_session_id, stripe_payment_intent_id,
   status, erased_at)
values ('52000000-0000-0000-0000-000000000f01', '52000000-0000-0000-0000-0000000000ed',
        public.gdpr_tombstone_profile_id(), 5000, 'cs_725_fund_a', 'pi_725_fund_a',
        'succeeded', now());

-- The ledger as it stands the moment before the erasure runs: these deliveries were written when
-- A was a live member, so the trigger had nothing to redact on the way in. Inserted BEFORE A's
-- request row exists, which is also the true order of events.
insert into public.stripe_webhook_events (event_id, type, payload, processed_at)
values
  -- Circle checkout: our metadata AND the customer id AND the personal data
  ('evt_725_checkout_a', 'checkout.session.completed',
   '{"id":"evt_725_checkout_a","type":"checkout.session.completed","data":{"object":{
       "id":"cs_725_a","customer":"cus_725_a","amount_total":1200,"currency":"eur",
       "payment_status":"paid","customer_details":{"email":"a725@test.athanor","name":"Aldo",
       "address":{"line1":"Via Test 1","city":"Milano","country":"IT"}},
       "metadata":{"kind":"subscription","profile_id":"52000000-0000-0000-0000-0000000000aa"}}}}'::jsonb,
   now()),
  -- Invoice: no metadata of ours anywhere. Only the customer id can find this one.
  ('evt_725_invoice_a', 'invoice.payment_failed',
   '{"id":"evt_725_invoice_a","type":"invoice.payment_failed","data":{"object":{
       "id":"in_725_a","customer":"cus_725_a","customer_email":"a725@test.athanor",
       "customer_name":"Aldo","amount_due":1200,"currency":"eur"}}}'::jsonb,
   now()),
  -- Ticket refund: no metadata, no customer. Only the payment intent can find this one.
  ('evt_725_refund_a', 'charge.refunded',
   '{"id":"evt_725_refund_a","type":"charge.refunded","data":{"object":{
       "id":"ch_725_a","payment_intent":"pi_725_a","amount_refunded":2500,"currency":"eur",
       "billing_details":{"email":"a725@test.athanor","name":"Aldo"}}}}'::jsonb,
   null),
  -- B's, and B is not going anywhere.
  ('evt_725_checkout_b', 'checkout.session.completed',
   '{"id":"evt_725_checkout_b","type":"checkout.session.completed","data":{"object":{
       "id":"cs_725_b","customer":"cus_725_b","amount_total":12000,"currency":"eur",
       "customer_details":{"email":"b725@test.athanor","name":"Bea"},
       "metadata":{"kind":"subscription","profile_id":"52000000-0000-0000-0000-0000000000bb"}}}}'::jsonb,
   now());

-- The fixture is only worth something if it starts legible.
select ok(
  (select strpos(payload::text, 'a725@test.athanor') > 0
     from public.stripe_webhook_events where event_id = 'evt_725_checkout_a'),
  'before the erasure the ledger holds A''s email in full — this is the bug #725 was filed for');
select ok(
  (select strpos(payload::text, '52000000-0000-0000-0000-0000000000aa') > 0
     from public.stripe_webhook_events where event_id = 'evt_725_checkout_a'),
  'and the profile id that links it back to the account');

-- A's own request, mid-cascade. 'processing' rather than 'requested' so the ban trigger
-- (20260910140902) stays out of this file's way, exactly as 0149 does.
insert into public.gdpr_erasure_requests (id, profile_id, status)
values ('52000000-0000-0000-0000-0000000000d1', '52000000-0000-0000-0000-0000000000aa',
        'processing');

-- ── 7. erasure time: the sweep inside the payment reach ──────────────────────────────────

select lives_ok(
  $$ select public.gdpr_erase_payment_footprint('52000000-0000-0000-0000-0000000000aa') $$,
  'A''s payment footprint is pseudonymised, ledger included');

-- The ruling's proof, stated the way the ruling states it: no row's payload matches the erased
-- member. `strpos` over the whole document rather than a path match, so an identity hiding at a
-- path nobody thought of still fails this.
select is(
  (select count(*)::int from public.stripe_webhook_events
    where strpos(payload::text, '52000000-0000-0000-0000-0000000000aa') > 0),
  0, 'NO ledger row still names the erased member — the assertion the ruling asked for');
select is(
  (select count(*)::int from public.stripe_webhook_events
    where strpos(payload::text, 'a725@test.athanor') > 0),
  0, 'and none still holds their email');
select is(
  (select count(*)::int from public.stripe_webhook_events
    where strpos(payload::text, 'Aldo') > 0),
  0, 'or their name');

select is(
  (select payload #> '{data,object,customer_details}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'null'::jsonb, 'the checkout session''s customer_details is nulled');
select is(
  (select payload #>> '{data,object,metadata,profile_id}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  null, 'and metadata.profile_id with it');
select is(
  (select payload #>> '{data,object,metadata,kind}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'subscription', 'the routing key survives — only the identity goes');

-- Claim 3: the money is the record the ruling retains.
select is(
  (select payload #>> '{data,object,customer}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'cus_725_a', 'the Stripe customer id is KEPT — pseudonymise, never delete');
select is(
  (select (payload #>> '{data,object,amount_total}')::int from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  1200, 'the amount is kept');
select is(
  (select payload #>> '{data,object,payment_status}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'paid', 'and the payment status');

-- Claim 1, the two arms that exist because the first one cannot see these events at all.
select is(
  (select payload #>> '{data,object,customer_email}' from public.stripe_webhook_events
    where event_id = 'evt_725_invoice_a'),
  null, 'the INVOICE is caught by the customer arm — it carries no metadata of ours');
select is(
  (select (payload #>> '{data,object,amount_due}')::int from public.stripe_webhook_events
    where event_id = 'evt_725_invoice_a'),
  1200, 'and keeps its amount');
select is(
  (select payload #> '{data,object,billing_details}' from public.stripe_webhook_events
    where event_id = 'evt_725_refund_a'),
  'null'::jsonb, 'the REFUND is caught by the payment-intent arm — it carries neither');
select is(
  (select payload #>> '{data,object,payment_intent}' from public.stripe_webhook_events
    where event_id = 'evt_725_refund_a'),
  'pi_725_a', 'and keeps the payment intent, which is a Stripe id like any other');

-- Claim 4, the half that lives in the row rather than in the payload.
select is(
  (select type from public.stripe_webhook_events where event_id = 'evt_725_checkout_a'),
  'checkout.session.completed', 'type is untouched');
select ok(
  (select processed_at is not null from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'processed_at is untouched — the dedupe gate does not move');
-- Scoped to this file's own event ids rather than the whole table: pgTAP replays from zero in
-- CI, but the same file is run by hand against staging (`supabase db query --linked`), whose
-- ledger is not empty. A bare count(*) would pass in CI and fail there, which is the wrong way
-- round for an assertion about deletion.
select is(
  (select count(*)::int from public.stripe_webhook_events where event_id like 'evt_725_%'), 4,
  'and no row was deleted: redact, never delete');

select ok(
  (select strpos(payload::text, 'b725@test.athanor') > 0
     from public.stripe_webhook_events where event_id = 'evt_725_checkout_b'),
  'B''s event is untouched — one member''s erasure is one member''s');

-- Idempotent: R-8 §7.5 re-drives requests by hand, and a second pass must move nothing.
create temporary table ledger_snapshot on commit drop as
  select event_id, payload, processed_at from public.stripe_webhook_events;

select lives_ok(
  $$ select public.gdpr_erase_payment_footprint('52000000-0000-0000-0000-0000000000aa') $$,
  'a re-run over an already-erased member is a no-op, not an error');
select is(
  (select count(*)::int from public.stripe_webhook_events e
     join ledger_snapshot s using (event_id)
    where e.payload is distinct from s.payload
       or e.processed_at is distinct from s.processed_at),
  0, 'and it changed nothing at all');

-- ── 8. write time: what the cascade itself provokes ──────────────────────────────────────
-- The amendment's whole reason. A is still a live profile here — the account delete is step (4b),
-- after everything above — so this is the orphan rule NOT firing and the open-request rule
-- carrying the case on its own.

select ok(
  (select exists (select 1 from public.profiles where id = '52000000-0000-0000-0000-0000000000aa')),
  'A''s profile still exists at this point — the account delete is the cascade''s last step');

insert into public.stripe_webhook_events (event_id, type, payload)
values ('evt_725_sub_deleted_a', 'customer.subscription.deleted',
  '{"id":"evt_725_sub_deleted_a","type":"customer.subscription.deleted","data":{"object":{
      "id":"sub_725_a","customer":"cus_725_a","status":"canceled","currency":"eur",
      "metadata":{"profile_id":"52000000-0000-0000-0000-0000000000aa"}}}}'::jsonb);

select is(
  (select payload #>> '{data,object,metadata,profile_id}' from public.stripe_webhook_events
    where event_id = 'evt_725_sub_deleted_a'),
  null,
  'the cancellation webhook the erasure ITSELF provokes lands redacted — the sweep could never have caught it');
select is(
  (select payload #>> '{data,object,status}' from public.stripe_webhook_events
    where event_id = 'evt_725_sub_deleted_a'),
  'canceled', 'and the subscription state it reports is kept — this is still the money record');

-- A refund that settles days later, against the fund contribution the fund reach tombstoned.
insert into public.stripe_webhook_events (event_id, type, payload)
values ('evt_725_fund_refund_a', 'charge.refunded',
  '{"id":"evt_725_fund_refund_a","type":"charge.refunded","data":{"object":{
      "id":"ch_725_fund_a","payment_intent":"pi_725_fund_a","amount_refunded":5000,
      "billing_details":{"email":"a725@test.athanor","name":"Aldo"}}}}'::jsonb);

select is(
  (select payload #> '{data,object,billing_details}' from public.stripe_webhook_events
    where event_id = 'evt_725_fund_refund_a'),
  'null'::jsonb,
  'a late refund on a tombstoned CONTRIBUTION is redacted on arrival — erased_at outlives the tombstone');

-- The orphan rule: a profile id nothing resolves. Every erasure served before this migration
-- looks exactly like this, which is what the backfill keys on.
insert into public.stripe_webhook_events (event_id, type, payload)
values ('evt_725_orphan', 'checkout.session.completed',
  '{"id":"evt_725_orphan","type":"checkout.session.completed","data":{"object":{
      "id":"cs_725_orphan","amount_total":2500,
      "customer_details":{"email":"gone@test.athanor","name":"Gone"},
      "metadata":{"profile_id":"52000000-0000-0000-0000-00000000dead"}}}}'::jsonb);

select is(
  (select payload #> '{data,object,customer_details}' from public.stripe_webhook_events
    where event_id = 'evt_725_orphan'),
  'null'::jsonb,
  'an event naming a profile that no longer exists is redacted on arrival — the backfill''s own predicate');

-- And the trigger is a scalpel, not a hammer: a live member's delivery is stored verbatim.
insert into public.stripe_webhook_events (event_id, type, payload)
values ('evt_725_live_b', 'checkout.session.completed',
  '{"id":"evt_725_live_b","type":"checkout.session.completed","data":{"object":{
      "id":"cs_725_b2","customer":"cus_725_b","amount_total":12000,
      "customer_details":{"email":"b725@test.athanor","name":"Bea"},
      "metadata":{"profile_id":"52000000-0000-0000-0000-0000000000bb"}}}}'::jsonb);

select is(
  (select payload #>> '{data,object,customer_details,email}' from public.stripe_webhook_events
    where event_id = 'evt_725_live_b'),
  'b725@test.athanor',
  'a LIVE member''s delivery is stored verbatim — the trigger redacts the erased, not the ledger');
select is(
  (select payload #>> '{data,object,metadata,profile_id}' from public.stripe_webhook_events
    where event_id = 'evt_725_live_b'),
  '52000000-0000-0000-0000-0000000000bb',
  'and keeps the link the webhook handlers route on');

-- ── 9. the dedupe gate, after the redaction ──────────────────────────────────────────────
-- The claim rule 6 cares about. Stripe re-delivers for days; if a re-delivery could rewrite the
-- payload, the erasure would be undone by a retry nobody is watching.

insert into public.stripe_webhook_events (event_id, type, payload)
values ('evt_725_checkout_a', 'checkout.session.completed',
  '{"id":"evt_725_checkout_a","type":"checkout.session.completed","data":{"object":{
      "id":"cs_725_a","customer":"cus_725_a","amount_total":1200,
      "customer_details":{"email":"a725@test.athanor","name":"Aldo"},
      "metadata":{"profile_id":"52000000-0000-0000-0000-0000000000aa"}}}}'::jsonb)
on conflict (event_id) do nothing;

select is(
  (select count(*)::int from public.stripe_webhook_events where event_id = 'evt_725_checkout_a'),
  1, 'a re-delivery inserts no second row — ON CONFLICT DO NOTHING, the handler''s ignoreDuplicates');
select is(
  (select payload #> '{data,object,customer_details}' from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'null'::jsonb,
  'and it does NOT put the identity back — the stored payload is still the redacted one');
select ok(
  (select processed_at is not null from public.stripe_webhook_events
    where event_id = 'evt_725_checkout_a'),
  'processed_at still answers the replay, so the handler acks 200 as before');

-- The claim UPDATE the handler runs (handlers.ts:877-883), against a processed row: zero rows,
-- which is what tells the handler this is a true replay.
with claimed as (
  update public.stripe_webhook_events
     set claimed_at = now()
   where event_id = 'evt_725_checkout_a'
     and processed_at is null
     and (claimed_at is null or claimed_at < now() - interval '15 minutes')
  returning event_id
)
select is((select count(*)::int from claimed), 0,
  'the lease claim takes nothing on a processed row — redaction did not make it reclaimable');

-- …and a redacted row that was never processed is still claimable: redaction must not strand an
-- event the handler has yet to do the work for.
with claimed as (
  update public.stripe_webhook_events
     set claimed_at = now()
   where event_id = 'evt_725_refund_a'
     and processed_at is null
     and (claimed_at is null or claimed_at < now() - interval '15 minutes')
  returning event_id
)
select is((select count(*)::int from claimed), 1,
  'an unprocessed redacted row is still claimable — the work still happens, on a redacted copy');

-- ── 10. the client surface is unchanged ──────────────────────────────────────────────────
-- 0024 owns this, but a new trigger on a service-role-only table is exactly the kind of change
-- that could hand somebody a way in: assert the grants still say no.

set local role authenticated;
set local request.jwt.claims = '{"sub":"52000000-0000-0000-0000-0000000000bb","role":"authenticated"}';
select throws_ok($$
  insert into public.stripe_webhook_events (event_id, type, payload)
  values ('evt_725_client', 'checkout.session.completed', '{}'::jsonb)
$$, '42501', null, 'the trigger gave no client a way into the ledger');
reset role;

select * from finish();
rollback;
