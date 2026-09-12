-- #725: the webhook ledger keeps the identity an erasure just removed.
--
-- `stripe_webhook_events.payload` stores the whole Stripe event. Depending on the type that JSON
-- carries the member's email, name and billing address (`customer_details` on a Checkout session,
-- `billing_details` on a charge, `customer_email` on an invoice, `individual` on a Connect
-- account) and `metadata.profile_id`, the direct link back to the account. #715 left the table
-- out of its reaper on the grounds that pseudonymising rule 6's dedupe guard needs its own
-- design; this is that design.
--
-- Marco ruled it on 2026-09-09 (#725): REDACT, NEVER DELETE — the row stays, `event_id` and
-- `processed_at` keep the dedupe gate intact, and the payload loses the personal data — AT
-- ERASURE TIME rather than on the ten-year clock, so no Article 17 request served before 2036
-- leaves the residue. The reaper is NOT extended here.
--
-- ── Why the erasure-time sweep alone is not enough (the 2026-09-11 amendment) ───────────────
--
-- The sweep below cannot be the only arm, and `erasure-job` is what proves it. Step (3b-bis)
-- cancels the member's Circle subscription BEFORE the money steps run (logic.ts:447-526), and
-- Stripe answers with `customer.subscription.deleted` — carrying `subscription_data.metadata`'s
-- `profile_id` (create-circle-checkout/logic.ts:75) and the customer id. That delivery lands
-- AFTER the pass that was supposed to have cleaned up, which stripe-webhook's own comment
-- already says out loud: «the FIRST event this endpoint sees after an erasure» (handlers.ts:494).
-- Refunds and disputes that settle days later land the same way. An erasure-time-only answer
-- would therefore pass its own pgTAP proof and still hand every erased Circle subscriber a fresh
-- copy of their identity. Hence the second arm: a BEFORE INSERT trigger that redacts on the way
-- in, so the ledger cannot accept what the cascade has already removed.
--
-- ── What is NOT caught, and it is the ruling's accepted limit ───────────────────────────────
--
-- Events naming the member by nothing we can map: `charge.refunded` / `charge.dispute.created`
-- for a FUND contribution, whose only link is the payment intent on `fund_contributions` — a row
-- the fund reach tombstones BEFORE this function runs (step 3 vs step 3c), so by the time the
-- sweep looks there is no profile left to match. The trigger catches those on arrival instead
-- (`fund_contributions.erased_at` outlives the tombstone), which leaves exactly one hole: such an
-- event already in the ledger at erasure time. Tickets and Circle have no such gap — their rows
-- keep the identity until this very function nulls it.
--
-- ── Dedupe is not at risk, and that is a fact about the code rather than a hope ─────────────
--
-- Nothing reads `payload` back. The single reference in `supabase/functions` is the write at
-- handlers.ts:862; no migration reads it; the handler processes the in-memory event. The gate is
-- `event_id` + `processed_at` + `claimed_at`, all untouched here, and a re-delivery hits
-- `ignoreDuplicates: true` (ON CONFLICT DO NOTHING) so it cannot put the identity back.
-- `0152_stripe_webhook_payload_redaction.test.sql` asserts both halves.

-- ── 1. the identity keys, in one place ─────────────────────────────────────────────────────
-- A list, not a path: the same field sits at a different depth in every event shape
-- (`data.object.customer_details`, `data.object.charges.data[].billing_details`,
-- `data.object.parent.subscription_details.metadata.profile_id`), and a path-by-path redaction
-- would be a new migration per Stripe event type. IMMUTABLE and argument-free so the redactor
-- below can be immutable too.
--
-- `name` is deliberately absent: it is also a product's name and a price's nickname, and nulling
-- those would destroy the description of what was paid for — the money fact the ruling keeps.
-- Every personal name in a Stripe payload sits inside one of the objects below.
create function public.gdpr_stripe_identity_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'address',                -- customer.address
    'billing_details',        -- charge, payment_method: name, email, phone, address
    'business_profile',       -- Connect account
    'client_reference_id',    -- unused today; free if it is ever set to a profile id
    'company',                -- Connect account
    'customer_address',       -- invoice
    'customer_details',       -- checkout.session: email, name, address, tax ids
    'customer_email',         -- invoice
    'customer_name',          -- invoice
    'customer_phone',         -- invoice
    'email',                  -- Connect account, customer
    'individual',             -- Connect account: name, dob, address, id numbers
    'phone',                  -- customer
    'profile_id',             -- OURS: the link back to the account (metadata.profile_id)
    'receipt_email',          -- charge, payment_intent
    'shipping',               -- charge, payment_intent
    'shipping_details',       -- checkout.session
    'verified_outputs'        -- identity.verification_session: document data
  ]::text[];
$$;

comment on function public.gdpr_stripe_identity_keys() is
  'The JSON keys a GDPR redaction nulls anywhere in a Stripe event payload (#725). One home for the list: gdpr_redact_stripe_identity() reads it, 0152 asserts it. `name` is excluded on purpose — it is also a product name; every personal name sits inside one of these objects. Service-role only.';

revoke execute on function public.gdpr_stripe_identity_keys() from public, anon, authenticated;
grant execute on function public.gdpr_stripe_identity_keys() to service_role;

-- ── 2. the redactor ────────────────────────────────────────────────────────────────────────
-- Nulls, never removes: a key that vanishes reads as «Stripe never sent one», a key set to null
-- reads as «this was redacted», and the shape stays the same for anyone auditing the ledger. It
-- also keeps the expression indexes below usable — a redacted row's
-- `payload #>> '{data,object,metadata,profile_id}'` is NULL, so it drops out of the partial index
-- instead of sitting in it forever.
--
-- Recursive because the payload is: `data.object`, `data.previous_attributes`, the arrays under
-- `lines.data` and `charges.data`. Depth is Stripe's, single digits.
create function public.gdpr_redact_stripe_identity(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys text[] := public.gdpr_stripe_identity_keys();
  v_out  jsonb;
begin
  case jsonb_typeof(p_payload)
    when 'object' then
      select jsonb_object_agg(
               e.key,
               case when e.key = any (v_keys) then 'null'::jsonb
                    else public.gdpr_redact_stripe_identity(e.value) end)
        into v_out
        from jsonb_each(p_payload) as e;
      return coalesce(v_out, '{}'::jsonb);
    when 'array' then
      select coalesce(jsonb_agg(public.gdpr_redact_stripe_identity(a.value)), '[]'::jsonb)
        into v_out
        from jsonb_array_elements(p_payload) as a;
      return v_out;
    else
      return p_payload;
  end case;
end;
$$;

comment on function public.gdpr_redact_stripe_identity(jsonb) is
  'GDPR redaction of a Stripe event payload (#725): every key in gdpr_stripe_identity_keys(), at any depth, set to JSON null; everything else — amounts, currencies, statuses, Stripe ids, timestamps — kept verbatim. Nulls rather than removes, so the shape says «redacted» instead of «never sent». Idempotent. Used by gdpr_erase_payment_footprint (erasure time) and stripe_webhook_event_redact_erased (write time). Service-role only.';

revoke execute on function public.gdpr_redact_stripe_identity(jsonb) from public, anon, authenticated;
grant execute on function public.gdpr_redact_stripe_identity(jsonb) to service_role;

-- ── 3. the three handles an erasure can match on ───────────────────────────────────────────
-- RELEASE-RUNBOOK §4.1 recorded «exactly one index, the event_id primary key» and said a partial
-- index was the right shape if one were ever needed. These are that shape: partial on the
-- expression itself, so they hold only the rows that carry a handle and a redacted row leaves
-- the index. The sweep and the backfill below spell the expressions exactly as indexed.
create index stripe_webhook_events_payload_profile_id_idx
  on public.stripe_webhook_events ((payload #>> '{data,object,metadata,profile_id}'))
  where (payload #>> '{data,object,metadata,profile_id}') is not null;

create index stripe_webhook_events_payload_customer_idx
  on public.stripe_webhook_events ((payload #>> '{data,object,customer}'))
  where (payload #>> '{data,object,customer}') is not null;

create index stripe_webhook_events_payload_payment_intent_idx
  on public.stripe_webhook_events ((payload #>> '{data,object,payment_intent}'))
  where (payload #>> '{data,object,payment_intent}') is not null;

-- ── 4. erasure time: the sweep rides inside the payment reach ──────────────────────────────
-- Folded into gdpr_erase_payment_footprint rather than added as a fourth RPC, and the reason is
-- ordering rather than tidiness: the customer id it matches on lives on `circle_memberships`,
-- and this function's own UPDATE is what nulls the profile that points at it. Reading it here,
-- in the same transaction, one statement earlier, is the only place the map still exists. A
-- separate RPC would also mean a new deploy-order dependency (a missing RPC answers PGRST202 and
-- lands the request on a terminal `failed`), a `gen:types` diff, and an edit to the «five RPCs
-- per request» pin in erasure-job/logic.test.ts — for a step that must run at exactly this
-- moment anyway.
--
-- Body preserved verbatim from 20260908071656:76-114 except for §(c). Same signature, same
-- SECURITY INVOKER, same locked search_path; ACL restated after the `create or replace` as the
-- convention asks (see MIGRATIONS-ERRATA on 20260823130236: privileges do survive a replace —
-- restating is a courtesy to the reader, not a mechanism).
create or replace function public.gdpr_erase_payment_footprint(p_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_customers       text[];
  v_payment_intents text[];
begin
  if p_profile_id = public.gdpr_tombstone_profile_id() then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  -- (a) READ THE STRIPE HANDLES FIRST (#725). The two updates below are what make the member
  -- unfindable; after them `circle_memberships.profile_id` is NULL and the ticket has no buyer,
  -- so a ledger sweep run afterwards could only ask «some erased member?» and never «this one».
  -- Collected before anything moves, used in (c). NULL array = the member had none.
  select array_agg(distinct m.stripe_customer_id)
    into v_customers
    from public.circle_memberships m
   where m.profile_id = p_profile_id;

  select array_agg(distinct t.stripe_payment_id)
    into v_payment_intents
    from public.event_tickets t
   where t.user_id = p_profile_id
     and t.stripe_payment_id is not null;

  -- (b) Tickets. The money columns (stripe_payment_id, status, timestamps) and the event link are
  -- kept — the row is the financial record the ruling retains. `qr_token` goes with the identity:
  -- it is a bearer credential for the turnstile, not a financial fact, and a ticket whose owner
  -- has been erased must not still open a door.
  --
  -- `coalesce(erased_at, v_now)` and the `user_id is not null` predicate together make this
  -- idempotent: a re-run of an already-erased request matches nothing, and if it somehow matched
  -- it would not move the retention clock forward.
  update public.event_tickets
     set user_id   = null,
         qr_token  = null,
         erased_at = coalesce(erased_at, v_now)
   where user_id = p_profile_id;

  update public.circle_memberships
     set profile_id = null,
         erased_at  = coalesce(erased_at, v_now)
   where profile_id = p_profile_id;

  -- (c) THE WEBHOOK LEDGER (#725). Redact every event that names this member — by our own
  -- `metadata.profile_id`, by a customer id whose membership was just pseudonymised, or by a
  -- payment intent from one of their tickets. The row itself is untouched: `event_id`, `type`,
  -- `received_at`, `processed_at` and `claimed_at` are the dedupe gate and none of them moves.
  --
  -- Idempotent twice over: after a first pass `metadata.profile_id` is null so it matches
  -- nothing, and on a re-run (a) finds no memberships or tickets to read handles from, so both
  -- arrays are NULL and the last two predicates are false.
  update public.stripe_webhook_events e
     set payload = public.gdpr_redact_stripe_identity(e.payload)
   where (e.payload #>> '{data,object,metadata,profile_id}') = p_profile_id::text
      or (v_customers is not null
          and (e.payload #>> '{data,object,customer}') = any (v_customers))
      or (v_payment_intents is not null
          and (e.payload #>> '{data,object,payment_intent}') = any (v_payment_intents));
end;
$$;

comment on function public.gdpr_erase_payment_footprint(uuid) is
  'GDPR erasure, retained payment tables (#107, ruling #184): null the identity on event_tickets (and its qr_token) and circle_memberships, stamp erased_at, keep every money column and Stripe id. Since #725 it also redacts the stripe_webhook_events payloads that name the member — by metadata.profile_id, by the customer id of the membership it is about to pseudonymise, or by a ticket''s payment intent — leaving event_id, type, received_at, processed_at and claimed_at untouched so the dedupe gate is unchanged. Pseudonymise, never delete; the 10-year reaper (#715) does not cover the ledger. Service-role only; idempotent.';

revoke execute on function public.gdpr_erase_payment_footprint(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_erase_payment_footprint(uuid) to service_role;

-- ── 5. write time: the ledger refuses what the cascade has already removed ─────────────────
-- The second arm, and the one the 2026-09-11 amendment exists for. A BEFORE INSERT trigger sees
-- every delivery — including the `customer.subscription.deleted` the erasure itself provokes,
-- and every refund or dispute that settles afterwards — and redacts on the way in.
--
-- On the table rather than in stripe-webhook on purpose: this is the ledger's own invariant, it
-- needs no function redeploy to take effect, and it holds for every writer of the table rather
-- than for the one that happens to exist today. Rule 6 is unaffected — the webhook is still the
-- only writer of money state; this rewrites the copy of the event, never a Stripe transition.
--
-- Three ways an event names an erased member, cheapest first, short-circuiting:
--   1. `metadata.profile_id` — ours, on every Checkout session, subscription and verification
--      session. A profile that no longer exists, or one whose erasure request is still open (the
--      window between the cancel in (3b-bis) and the account delete in (4b)), is an erased member.
--   2. `data.object.customer` against a pseudonymised membership — how invoices are caught at
--      all: we set no invoice metadata, so `metadata.profile_id` is absent there.
--   3. `data.object.payment_intent` against a pseudonymised ticket or a contribution whose
--      erased_at is stamped — charge.refunded and charge.dispute.created carry no profile id.
-- Every lookup rides an existing index: profiles PK, gdpr_erasure_requests_open_by_profile,
-- circle_memberships' unique stripe_customer_id, event_tickets_by_stripe_payment_id, and
-- fund_contributions' unique stripe_payment_intent_id.
create function public.stripe_webhook_event_redact_erased()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile_id text := new.payload #>> '{data,object,metadata,profile_id}';
  v_customer   text := new.payload #>> '{data,object,customer}';
  v_payment    text := new.payload #>> '{data,object,payment_intent}';
  v_erased     boolean := false;
begin
  -- A malformed id is not a match and must not raise: a webhook that 500s is a webhook Stripe
  -- retries forever, and the ledger write is the first thing the handler does.
  if v_profile_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_erased :=
      not exists (select 1 from public.profiles p where p.id = v_profile_id::uuid)
      or exists (select 1 from public.gdpr_erasure_requests r
                  where r.profile_id = v_profile_id::uuid and r.status <> 'done');
  end if;

  if not v_erased and v_customer is not null then
    v_erased := exists (select 1 from public.circle_memberships m
                         where m.stripe_customer_id = v_customer
                           and m.erased_at is not null);
  end if;

  if not v_erased and v_payment is not null then
    v_erased := exists (select 1 from public.event_tickets t
                         where t.stripe_payment_id = v_payment
                           and t.erased_at is not null)
             or exists (select 1 from public.fund_contributions c
                         where c.stripe_payment_intent_id = v_payment
                           and c.erased_at is not null);
  end if;

  if v_erased then
    new.payload := public.gdpr_redact_stripe_identity(new.payload);
  end if;

  return new;
end;
$$;

comment on function public.stripe_webhook_event_redact_erased() is
  'BEFORE INSERT on stripe_webhook_events (#725): redacts the payload of any delivery that names an erased member — metadata.profile_id pointing at a gone or under-erasure profile, a customer id on a pseudonymised membership, a payment intent on a pseudonymised ticket or contribution. The arm the erasure-time sweep cannot cover: erasure-job cancels the Circle subscription on its way out, so Stripe''s customer.subscription.deleted lands AFTER the sweep has run (handlers.ts:494), and refunds land days later. Nulls nothing else — event_id, type and the payload''s money columns are untouched.';

revoke execute on function public.stripe_webhook_event_redact_erased() from public, anon, authenticated;

create trigger stripe_webhook_events_redact_erased
  before insert on public.stripe_webhook_events
  for each row execute function public.stripe_webhook_event_redact_erased();

-- ── 6. the backfill — every erasure served before today ────────────────────────────────────
-- Decided, not discovered: the ruling asks that no Article 17 request leaves this residue, and
-- the requests already served are exactly the ones that did. Nothing lists their profile ids
-- (the request row's profile_id is SET NULL by the account cascade, 20260908073545), so they are
-- reached the only three ways left. Each predicate is the indexed expression, verbatim.
--
-- The orphan arm below is wider than «erased»: it also catches events naming a profile that
-- never existed on this project — a staging reseed, a test-mode delivery (#473's nine rows were
-- exactly that shape). Redacting those costs nothing and keeps the rule one sentence long.

-- (a) the profile is gone
update public.stripe_webhook_events e
   set payload = public.gdpr_redact_stripe_identity(e.payload)
 where (e.payload #>> '{data,object,metadata,profile_id}')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (
     select 1 from public.profiles p
      where p.id = (e.payload #>> '{data,object,metadata,profile_id}')::uuid);

-- (b) the customer's membership is pseudonymised
update public.stripe_webhook_events e
   set payload = public.gdpr_redact_stripe_identity(e.payload)
 where (e.payload #>> '{data,object,customer}') is not null
   and exists (
     select 1 from public.circle_memberships m
      where m.stripe_customer_id = (e.payload #>> '{data,object,customer}')
        and m.erased_at is not null);

-- (c) the payment intent belongs to a pseudonymised ticket or contribution
update public.stripe_webhook_events e
   set payload = public.gdpr_redact_stripe_identity(e.payload)
 where (e.payload #>> '{data,object,payment_intent}') is not null
   and (exists (
         select 1 from public.event_tickets t
          where t.stripe_payment_id = (e.payload #>> '{data,object,payment_intent}')
            and t.erased_at is not null)
     or exists (
         select 1 from public.fund_contributions c
          where c.stripe_payment_intent_id = (e.payload #>> '{data,object,payment_intent}')
            and c.erased_at is not null));

-- ── 7. the table comment, which now has a third mutation to name ───────────────────────────
-- Rebuilt from the 20260821164731 text rather than appended to: `comment on table` replaces the
-- whole string, and 0128 requires the CONVENTION EXEMPTION (#180) tag to survive. The exemption
-- itself needs the new sentence to stay honest — `payload` mutates now, and unlike claimed_at and
-- processed_at it does not record its own mutation.
comment on table public.stripe_webhook_events is
  'Idempotency ledger — every webhook upserts on event_id before processing (backend 00 §7). Service-role only.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — rows DO mutate (the handler stamps claimed_at to take the processing lease, clears it on release, then stamps processed_at on completion), but each of those columns records its own mutation with its meaning attached. A generic updated_at would only say "one of them moved". Rule #6 also applies: money state is a cache of Stripe, and the authoritative timeline is Stripe''s.

Since #725 `payload` mutates too, and it is the one mutation that does not record itself: a GDPR erasure redacts the identity out of every event naming the erased member (gdpr_erase_payment_footprint), and the BEFORE INSERT trigger stripe_webhook_events_redact_erased redacts the deliveries that arrive after the cascade — starting with the customer.subscription.deleted the cascade itself provokes. What records THAT is the erasure request and the erased_at stamps it keys on, not a timestamp on this row; the dedupe columns are untouched by both.';
