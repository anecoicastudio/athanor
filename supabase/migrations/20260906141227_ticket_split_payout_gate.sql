-- #104 — a paid event needs an organiser who can actually be paid.
--
-- Ruling 2026-09-06 (absorbed fee, destination charge): the ticket Checkout Session now carries
-- payment_intent_data.transfer_data.destination = the organiser's connected account, plus an
-- application_fee_amount of events.fee_pct percent. Stripe splits the money at payment time.
--
-- That turns an organiser with no usable connected account from a settlement inconvenience into a
-- payment that cannot be constructed: Stripe rejects a destination whose transfers capability is
-- not active, and the rejection would land AFTER claim_event_seat has already held a seat. So the
-- refusal moves to creation time, where nothing has been claimed and the organiser can be told
-- what to do about it.
--
-- Two functions and two gates:
--   1. has_payouts_enabled(uid)            — the is_identity_verified twin, for the creation gates
--   2. organizer_payout_destination(event) — the account id itself, for create-ticket-checkout
--   3. create_event                        — gains the gate (RPC path)
--   4. enforce_paid_event_gate             — gains the same gate (direct-INSERT path, #448)
--
-- Both write paths, because #448 established that a gate in create_event alone leaves the direct
-- PostgREST INSERT open, and a paid event created that way would sell tickets that cannot settle.

-- ── 1. the payout-capability gate helper ─────────────────────────────────────────────────────
-- Mirrors is_identity_verified (20260617225450:27-39) deliberately and exactly: DEFINER with an
-- empty search_path, STABLE, and a coalesce to false. The coalesce is the load-bearing part —
-- payout_accounts is select-own under RLS and an organiser who never onboarded has NO ROW, so the
-- scalar subquery yields NULL. `if not null then raise` never fires: the gate would fail OPEN on
-- precisely the case it exists to catch. Asserted in 0147 as its own test.
--
-- payouts_enabled rather than charges_enabled: create-payout-onboarding requests only the
-- `transfers` capability (logic.ts:62), which is all a destination charge needs and all a recipient
-- account may hold, so charges_enabled is false on these accounts forever and gating on it would
-- refuse every organiser permanently. The flag itself is maintained only by stripe-webhook's
-- account.updated arm (W13), in both directions — Stripe revokes capabilities as well as granting
-- them, and this gate has to fail closed on the revocation.
create function public.has_payouts_enabled(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (select pa.payouts_enabled from public.payout_accounts pa where pa.profile_id = uid),
    false
  );
$$;
comment on function public.has_payouts_enabled(uuid) is
  'Reads payout_accounts.payouts_enabled under definer rights so the paid-event gates can require a payable organiser without exposing another member''s payout row cross-RLS (the table is select-own). Coalesces a missing row to false: an organiser who never onboarded must fail the gate, not slip past a NULL. Written only by stripe-webhook''s account.updated arm (rule #6).';
revoke execute on function public.has_payouts_enabled(uuid) from public, anon;
grant  execute on function public.has_payouts_enabled(uuid) to authenticated;
-- service_role explicitly, the is_identity_verified precedent (20260815164809:228): a write that
-- fires enforce_paid_event_gate under the service key would otherwise 42501 on the helper rather
-- than on the gate, which is a confusing failure and a broken staging seed.
grant  execute on function public.has_payouts_enabled(uuid) to service_role;

-- ── 2. the destination account, for the Checkout Session ─────────────────────────────────────
-- create-ticket-checkout runs on the BUYER's client. payout_accounts_select_own means the buyer's
-- read of the organiser's row returns zero rows, and reaching for the service-role client instead
-- is asserted against in _shared/auth-posture.test.ts:107-116, whose comment says exactly why: an
-- admin client there "would silently read rows the caller cannot see and price a Checkout session
-- from them". So the one value the session genuinely needs comes back through a definer function
-- that returns that value and nothing else.
--
-- Keyed on the EVENT, not on the organiser's uid: the disclosure is then scoped to organisers of
-- live paid events, which is exactly the set whose account a buyer is about to be sent to anyway.
-- A uid-keyed helper granted to `authenticated` would let any member enumerate any organiser's
-- Stripe account id.
--
-- Zero rows is the refusal signal and covers every miss uniformly: no such event, a deleted one, a
-- free one, no payout row, or a row whose capability Stripe has revoked. The caller cannot tell
-- them apart and does not need to — all five mean "this event cannot mint a Session".
create function public.organizer_payout_destination(p_event_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select pa.stripe_account_id
  from public.events e
  join public.payout_accounts pa on pa.profile_id = e.organizer_id
  where e.id = p_event_id
    and e.deleted_at is null
    and e.price_cents > 0
    and pa.payouts_enabled;
$$;
comment on function public.organizer_payout_destination(uuid) is
  'The connected-account id a paid event''s ticket Checkout Session must transfer to (#104), or NULL. Definer because payout_accounts is select-own and the buyer minting the session is not the organiser; event-keyed rather than uid-keyed so a member cannot enumerate organisers'' Stripe account ids. NULL covers every miss uniformly: unknown, deleted, free, un-onboarded, or capability revoked.';
revoke execute on function public.organizer_payout_destination(uuid) from public, anon;
grant  execute on function public.organizer_payout_destination(uuid) to authenticated;

-- ── 3. create_event gains the gate ───────────────────────────────────────────────────────────
-- create or replace, not drop+create: the signature is unchanged, so the execute grants from
-- 20260902084656:88-89 survive and PostgREST still resolves exactly one overload. Everything but
-- the new third refusal is that migration's body verbatim.
create or replace function public.create_event(
  p_title           text,
  p_category        public.event_category,
  p_is_online       boolean,
  p_starts_at       timestamptz,
  p_venue           text default null,
  p_city            text default null,
  p_lat             double precision default null,
  p_long            double precision default null,
  p_stream_url      text default null,
  p_ends_at         timestamptz default null,
  p_capacity        integer default null,
  p_price_cents     bigint default 0,
  p_currency        text default 'eur',
  p_settlement_ack  boolean default false,
  p_description     text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- All three refusals are scoped to a paid event. A free event needs no acknowledgement, no
  -- verified identity and no payout account, and leaves settlement_ack_at null — nothing settles.
  if p_price_cents > 0 then
    if not p_settlement_ack then
      raise exception 'settlement acknowledgement required' using errcode = '22023';
    end if;
    -- PRD §4.13. is_identity_verified is DEFINER precisely so an invoker body can gate on the flag
    -- without the column being readable cross-RLS (20260617225450:27). Fails closed: a null uid
    -- cannot reach here, and the helper coalesces a missing row to false.
    if not public.is_identity_verified(v_uid) then
      raise exception 'identity verification required' using errcode = '42501';
    end if;
    -- #104. Last of the three, because it is the one an organiser can fix in a single step and the
    -- composer sends them straight to Stripe onboarding from this message. 55000
    -- (object_not_in_prerequisite_state) rather than a second 42501: the client maps errcode to
    -- copy, and "verify your identity" and "finish getting paid" are different instructions.
    if not public.has_payouts_enabled(v_uid) then
      raise exception 'payout account required' using errcode = '55000';
    end if;
  end if;
  insert into public.events (
    organizer_id, title, category, is_online, venue, city, geo, stream_url,
    starts_at, ends_at, capacity, price_cents, currency, settlement_ack_at, description
  ) values (
    v_uid, p_title, p_category, p_is_online, p_venue, p_city,
    case when p_lat is not null and p_long is not null
      then extensions.st_point(p_long, p_lat)::extensions.geography
      else null end,
    p_stream_url, p_starts_at, p_ends_at, p_capacity, p_price_cents, p_currency,
    -- Server time, not the client's. The acknowledgement is evidence; a client-supplied timestamp
    -- would be evidence of nothing.
    case when p_price_cents > 0 then now() else null end,
    p_description
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ── 4. the direct-INSERT path gains the same gate ────────────────────────────────────────────
-- #448's whole point: a gate that lives only in create_event is bypassed by a plain PostgREST
-- INSERT, which the events_insert_own policy permits. Same errcodes, same messages, same ORDER, so
-- a refusal stays indistinguishable by path and the catalog needs one mapping rather than two.
create or replace function public.enforce_paid_event_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- settlement_ack_at, not a boolean: create_event takes p_settlement_ack and stamps the timestamp
  -- from now() server-side, so on the RPC path a paid row always arrives here with the column set.
  -- On a direct INSERT the column IS the claim, and what this asserts is that a claim was made.
  -- The VALUE is still the caller's on that path — see MIGRATIONS-ERRATA; presence is what the
  -- privilege layer could never express, and presence is what this closes.
  if new.settlement_ack_at is null then
    raise exception 'settlement acknowledgement required' using errcode = '22023';
  end if;
  if not public.is_identity_verified(new.organizer_id) then
    raise exception 'identity verification required' using errcode = '42501';
  end if;
  -- #104. new.organizer_id rather than auth.uid(): the trigger also fires for writes that are not
  -- the organiser's own, and the account that must be payable is the one the money is destined for.
  if not public.has_payouts_enabled(new.organizer_id) then
    raise exception 'payout account required' using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function public.enforce_paid_event_gate() is
  'Creation-time gate for paid events (#448, #104): a row with price_cents > 0 needs settlement_ack_at set (22023, #437), an identity-verified organiser (42501, PRD §4.13) and one whose connected account can receive payouts (55000, #104), on every write path rather than only inside create_event. The price test lives in the trigger WHEN clause, not here.';

-- create or replace preserves the ACL, so 20260822103819:81's revoke still stands and 0121's
-- #409 rule stays green. Restated rather than relied upon: a trigger function reachable by anon is
-- a privilege nobody can use and nobody audits, and the pg_default_acl 'f' row hands it out on
-- every CREATE. The two new functions above carry their own revokes at their declarations.
revoke execute on function public.enforce_paid_event_gate() from public, anon, authenticated;
