-- #725, review round one — the write-time arm redacts for an erasure that is IN FLIGHT, not for
-- every request that is merely not `done`.
--
-- `20260912070533` is applied and therefore append-only, so the correction lands here rather than
-- in it (rule 7). One behaviour change, one paragraph of prose that has nowhere else to live.
--
-- ── What was wrong ─────────────────────────────────────────────────────────────────────────
--
-- The trigger treated `status <> 'done'` as «this member is erased». That set includes the two
-- TERMINAL states, and they do not mean what the predicate assumed:
--
--   `partial` / `failed`  the cascade stopped short. R-8 (RELEASE-RUNBOOK §7.5) re-drives those
--                         by hand, and WITHDRAWING one — deleting the row, then re-deriving the
--                         ban — is a documented operator act. A member sitting on such a row may
--                         never have been erased at all and may go on using the account.
--
-- Redaction cannot be undone, so redacting every future delivery for such a member is a loss we
-- could not walk back after the withdrawal that the runbook tells operators to perform. Narrowed
-- to `requested` and `processing`: the first is «asked for, not yet claimed», the second is the
-- window the whole arm exists for — between the subscription cancel in (3b-bis) and the account
-- delete in (4b), which is when the `customer.subscription.deleted` the cascade provokes arrives.
--
-- Nothing is lost by the narrowing: whatever a stopped run actually DID reach is still caught by
-- the other two arms, which key on `erased_at` — on what happened, rather than on what was asked
-- for. A member whose memberships were pseudonymised before the run failed keeps being caught by
-- the customer arm; one whose run failed before the money steps was never erased in the first
-- place, and now correctly is not treated as though they had been.
--
-- ── The one limit this arm still has, stated where the next reader will look ────────────────
--
-- An event whose object IS the payment intent or the charge carries its id at `data.object.id`
-- and has no `data.object.payment_intent` to match on, so none of the three arms sees it. Neither
-- endpoint subscribes to `payment_intent.*` today — the handler's switch has no arm for it, and
-- `charge.refunded`, which we do take, carries `payment_intent` explicitly — so a fourth handle
-- would buy a lookup on every insert for a delivery that never arrives. If those types are ever
-- enabled, the change is a `coalesce(… 'payment_intent', … 'id')` here plus the matching arm and
-- index in the sweep.
--
-- ── What is NOT re-run here, deliberately ──────────────────────────────────────────────────
--
-- `20260912070533`'s backfill. It ran in the same push moments ago, and a second pass would match
-- the same rows and rewrite them to the same values. Its `::uuid` cast behind a regex guard is a
-- real risk on a ledger holding a non-UUID `metadata.profile_id` — SQL does not promise the guard
-- is evaluated before the anti-join's qual — but that statement runs BEFORE this file on every
-- project, so no migration can protect it. The protection is an operator pre-check, and it lives
-- in RELEASE-RUNBOOK §7.5 with the query that answers it. Staging answered 0 on 2026-09-12.

create or replace function public.stripe_webhook_event_redact_erased()
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
  -- retries forever, and the ledger write is the first thing the handler does. The regex is what
  -- makes the cast below safe, and plpgsql evaluates the branch before the body — which is
  -- exactly the guarantee a single SQL statement's AND chain does not give.
  if v_profile_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- `requested` / `processing` only — never the terminal states. See this file's header.
    v_erased :=
      not exists (select 1 from public.profiles p where p.id = v_profile_id::uuid)
      or exists (select 1 from public.gdpr_erasure_requests r
                  where r.profile_id = v_profile_id::uuid
                    and r.status in ('requested', 'processing'));
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
  'BEFORE INSERT on stripe_webhook_events (#725): redacts the payload of any delivery that names an erased member — metadata.profile_id pointing at a gone profile or one whose erasure is IN FLIGHT (requested/processing, never the terminal partial/failed: that member may never have been erased and §7.5 can withdraw the request), a customer id on a pseudonymised membership, or a payment intent on a pseudonymised ticket or contribution. The arm the erasure-time sweep cannot cover: erasure-job cancels the Circle subscription on its way out, so Stripe''s customer.subscription.deleted lands AFTER the sweep has run (handlers.ts:494), and refunds land days later. Nulls nothing else — event_id, type and the payload''s money columns are untouched.';

-- Restated after the `create or replace`, as the convention asks. Privileges do survive a replace
-- (MIGRATIONS-ERRATA on 20260823130236 has the proof); this costs one line and spares the next
-- reader the question. 0121 asserts it over the whole schema either way.
revoke execute on function public.stripe_webhook_event_redact_erased() from public, anon, authenticated;
