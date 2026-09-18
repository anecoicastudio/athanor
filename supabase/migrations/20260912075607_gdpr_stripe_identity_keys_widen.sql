-- #725, review round two — the identity key list missed the fields that are spelled differently
-- on the objects we actually receive.
--
-- `20260912070533` and `20260912073632` are applied and append-only, so the widening lands here.
-- `athanor-reviewer` found the gap: the list covered `customer_details` and `billing_details`,
-- which is most of the identity on a Checkout session or a charge, and nothing that carries
-- identity OUTSIDE those two objects on the other subscribed types. The prose in all three homes
-- (the migration headers, MIGRATIONS-ERRATA, docs/ARCHITECTURE §6) states the residue claim
-- absolutely, so a key we do not null is prose that is not true.
--
-- ── Verified, not remembered ────────────────────────────────────────────────────────────────
--
-- The #709 lesson applies here exactly: a repo comment asserting VENDOR behaviour is what
-- somebody believed, not what Stripe does. Every name below was checked against TWO independent
-- sources before it was added — Stripe's published object reference, and the pinned SDK's own
-- type definitions (`npm:stripe@22`, `_shared/stripe.ts:3`) in `Invoices.d.ts`, `Disputes.d.ts`
-- and friends. Names that only one source knew about are not here.
--
--   Invoice (`invoice.payment_failed`, handlers.ts:793)
--     customer_shipping      name + address, copied off the customer at finalisation
--     customer_tax_ids       a VAT number identifies a person or their business
--
--   Dispute (`charge.dispute.created`, handlers.ts:803) — under `evidence`, and spelled
--   differently from every other object, which is the whole reason this was missed:
--     customer_email_address NOT `customer_email`
--     customer_purchase_ip   an IP address is personal data under GDPR in its own right
--     billing_address        a string here, not the `address` object elsewhere
--     shipping_address       likewise
--   (`customer_name` was already covered — the evidence hash reuses that spelling.)
--   We never submit dispute evidence, so on our own disputes these arrive null. They are listed
--   anyway: the cost is one array element, and the alternative is a claim that holds only as long
--   as nobody ever responds to a chargeback from the Dashboard.
--
--   Connect account (`account.updated`, handlers.ts:813)
--     account_holder_name    on an external account (a bank account's holder), and on the
--                            payment-method details the SDK shares with ConfirmationTokens
--
-- ── What is deliberately NOT added ──────────────────────────────────────────────────────────
--
-- `settings.dashboard.display_name` on a Connect account. The reviewer raised it; I could not
-- confirm from either source what it holds for an Express account created the way
-- `create-payout-onboarding` creates them — it is as often a business's public brand name as a
-- person's name, and nulling a brand name would destroy a money-descriptive fact for no gain.
-- Named here rather than guessed at: if a payout account is ever seen carrying a member's own
-- name there, it is one array element away.
--
-- Also still not added: `name`. It is a product's name and a price's nickname far more often than
-- a person's, and every personal name in these payloads sits inside one of the keys above.
--
-- ── Why this is only a list change ──────────────────────────────────────────────────────────
--
-- `gdpr_redact_stripe_identity` reads the list on every call, so replacing the list is the whole
-- change: no trigger, no sweep, no index, no backfill. Worth stating because both functions are
-- IMMUTABLE — that is a promise to the planner, and if an INDEX had been built on the redactor,
-- replacing the list underneath it would have left the index silently disagreeing with the table.
-- None is: the three partial indexes from 20260912070533 are on `payload #>> …` and nothing else,
-- so there is nothing to reindex. Replacing a function invalidates dependent cached plans, so a
-- session that already called it in this connection picks the new list up too.
--
-- The rows already redacted on staging keep exactly what they lost; a wider list does not make a
-- second pass necessary, because the erasure sweep is idempotent and the fields added here were
-- absent from those payloads (they are invoice, dispute and Connect fields, and the redacted rows
-- are checkout sessions). Production has not had the first migration yet, so it gets the widened
-- list on its very first pass — this file rides in the same release.

create or replace function public.gdpr_stripe_identity_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- identity carried directly on the object
    'address',                -- customer.address
    'billing_details',        -- charge, payment_method: name, email, phone, address
    'business_profile',       -- Connect account
    'client_reference_id',    -- unused today; free if it is ever set to a profile id
    'company',                -- Connect account
    'customer_address',       -- invoice
    'customer_details',       -- checkout.session: email, name, address, tax ids
    'customer_email',         -- invoice
    'customer_name',          -- invoice, and dispute evidence (same spelling)
    'customer_phone',         -- invoice
    'customer_shipping',      -- invoice: name + address (#725 review round two)
    'customer_tax_ids',       -- invoice: VAT numbers (#725 review round two)
    'email',                  -- Connect account, customer
    'individual',             -- Connect account: name, dob, address, id numbers
    'phone',                  -- customer
    'profile_id',             -- OURS: the link back to the account (metadata.profile_id)
    'receipt_email',          -- charge, payment_intent
    'shipping',               -- charge, payment_intent
    'shipping_details',       -- checkout.session, invoice
    'verified_outputs',       -- identity.verification_session: document data
    -- dispute evidence, which spells its customer fields its own way
    'billing_address',        -- (#725 review round two)
    'customer_email_address', -- NOT customer_email (#725 review round two)
    'customer_purchase_ip',   -- an IP is personal data (#725 review round two)
    'shipping_address',       -- (#725 review round two)
    -- Connect external accounts
    'account_holder_name'     -- (#725 review round two)
  ]::text[];
$$;

comment on function public.gdpr_stripe_identity_keys() is
  'The JSON keys a GDPR redaction nulls anywhere in a Stripe event payload (#725). One home for the list: gdpr_redact_stripe_identity() reads it on every call, 0152 pins it by value. Covers identity carried outside customer_details/billing_details too — the invoice''s customer_shipping and customer_tax_ids, the dispute evidence hash''s own spellings (customer_email_address, customer_purchase_ip, billing_address, shipping_address) and a Connect external account''s account_holder_name. Excluded on purpose: `name` (also a product''s name) and settings.dashboard.display_name (as often a brand as a person). Service-role only.';

-- Restated after the `create or replace`, as the convention asks. Privileges survive a replace
-- (MIGRATIONS-ERRATA on 20260823130236); the redactor calls this as invoker, so service_role — the
-- erasure job's client and the role the webhook inserts as — needs EXECUTE for both arms to work.
revoke execute on function public.gdpr_stripe_identity_keys() from public, anon, authenticated;
grant execute on function public.gdpr_stripe_identity_keys() to service_role;
