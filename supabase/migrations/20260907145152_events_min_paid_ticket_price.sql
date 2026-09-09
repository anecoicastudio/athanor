-- #701 — a paid ticket costs at least €5,00. Ruling 2026-09-07.
--
-- The fee model stays absorbed and `fee_pct` stays at ten percent; what changes is the floor. Out
-- of Athanor's `fee_pct` share come Stripe's processing (1,5% + €0,25 on a standard EEA card), the
-- payout fee (0,25% + €0,10) and €2 per active organiser-month, which meet near €4,24 a ticket.
-- Under that, selling a ticket costs the platform money. A FREE event is untouched — this is a
-- band (`0 or >= 500`), never a minimum, and every arm below spells it that way.
--
-- Three places refuse, and they are not redundant:
--   1. `events_price_min`      — the CHECK. The only guard on an UPDATE, because the trigger below
--                                is BEFORE INSERT only, and the only one that covers a writer with
--                                no policy in front of it.
--   2. `create_event`          — the RPC path, so the composer gets an errcode it can turn into a
--                                sentence rather than a constraint-violation string.
--   3. `enforce_paid_event_gate` — the direct-INSERT path (#448). Both write paths refuse
--                                identically, which is the shape #104 established.
--
-- ── the errcode, and why it is not the CHECK's own ────────────────────────────────────────────
-- The two hand-raised arms use **22003** (`numeric_value_out_of_range`), which nothing in this
-- schema raises today. Class 22 is deliberate: it is the class the settlement arm already uses
-- (22023), and both mean "the value you sent is not one this column accepts", so the pair reads
-- as one family in `event-create.tsx`'s map.
--
-- The obvious alternative was 23514 — what `events_price_min` itself raises — on the reasoning
-- that one code would then cover every path with one client arm. Rejected, for two reasons that
-- only show up when you count:
--   * `events` carries twelve CHECK constraints, nine of them from its creating migration. A bare
--     `code === '23514'` arm in the composer would render "your price is too low" for an online
--     event with no stream_url, which is a different instruction entirely. Matching on the
--     constraint NAME inside the message would fix that, and is a string-match on an error body.
--   * 23514 is already hand-raised elsewhere in this schema (`20260614131843:109`,
--     `20260809032504:68`), so it is not an unclaimed code to begin with.
-- Nothing reaches the client from the bare CHECK in practice: there is no `updateEvent` in
-- `packages/api`, and the app's only creation path is the RPC. The CHECK is the backstop for
-- writers that are not this app, and its own 23514 is the right thing for those to see.

alter table public.events
  add constraint events_price_min check (price_cents = 0 or price_cents >= 500);

comment on constraint events_price_min on public.events is
  'A paid ticket costs at least 500 minor units (#701, ruling 2026-09-07); free stays free, so the band is `0 or >= 500` and not a simple minimum. Mirrored by value in packages/schemas/src/event.ts (MIN_PAID_TICKET_CENTS), packages/core/src/events/ticket-split.ts (re-export) and supabase/functions/create-ticket-checkout/logic.ts; packages/core/src/events/ticket-split.mirror.test.ts reads all four and fails if any drifts.';

-- ── create_event gains the floor arm, FIRST ──────────────────────────────────────────────────
-- create or replace, not drop+create: the signature is unchanged, so the execute grants from
-- 20260902084656:89-90 survive and PostgREST still resolves exactly one overload. Everything but
-- the new arm is 20260906141227's body verbatim.
--
-- First of the four on purpose. The other three are facts about the ORGANISER — a box unticked, an
-- identity unverified, an account that cannot be paid — and each is fixed somewhere other than the
-- form. An illegal price is a fact about the FIELD the organiser is looking at, and until it is
-- fixed the acknowledgement they would be asked to tick quotes a split of a price that cannot
-- exist. `event-create.tsx` states the same order client-side, as #104 requires.
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
  -- All four refusals are scoped to a paid event. A free event needs no floor, no acknowledgement,
  -- no verified identity and no payout account, and leaves settlement_ack_at null — nothing settles.
  if p_price_cents > 0 then
    -- #701. The literal 500 rather than a lookup: this body is append-only once applied, and the
    -- mirror test is what keeps it equal to MIN_PAID_TICKET_CENTS. 22003, see the header.
    if p_price_cents < 500 then
      raise exception 'paid ticket below the minimum price' using errcode = '22003';
    end if;
    if not p_settlement_ack then
      raise exception 'settlement acknowledgement required' using errcode = '22023';
    end if;
    -- PRD §4.13. is_identity_verified is DEFINER precisely so an invoker body can gate on the flag
    -- without the column being readable cross-RLS (20260617225450:27). Fails closed: a null uid
    -- cannot reach here, and the helper coalesces a missing row to false.
    if not public.is_identity_verified(v_uid) then
      raise exception 'identity verification required' using errcode = '42501';
    end if;
    -- #104. Last of the four, because it is the one an organiser can fix in a single step and the
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

-- ── the direct-INSERT path gains the same arm ────────────────────────────────────────────────
-- #448's whole point: a gate that lives only in create_event is bypassed by a plain PostgREST
-- INSERT, which the events_insert_own policy permits. Same errcodes, same messages, same ORDER, so
-- a refusal stays indistinguishable by path and the catalog needs one mapping rather than two.
--
-- The trigger's WHEN clause is already `coalesce(new.price_cents, 0) > 0` (20260822103819:93), so
-- the floor arm here is paid-only without saying so. `events_price_min` would refuse this row too,
-- a moment later and with 23514 — this arm exists so the two write paths give the SAME answer,
-- which is the property #448 bought and the one a client maps copy from.
create or replace function public.enforce_paid_event_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- #701, first for the same reason it is first in create_event: an illegal price is a fact about
  -- the price, and the acknowledgement below is meaningless until it is fixed.
  if new.price_cents < 500 then
    raise exception 'paid ticket below the minimum price' using errcode = '22003';
  end if;
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

-- `comment on function` REPLACES the whole text, so this restates 20260906141227's sentence with
-- the fourth refusal folded in rather than appending to it.
comment on function public.enforce_paid_event_gate() is
  'Creation-time gate for paid events (#448, #104, #701): a row with price_cents > 0 needs a price of at least 500 minor units (22003, #701), settlement_ack_at set (22023, #437), an identity-verified organiser (42501, PRD §4.13) and one whose connected account can receive payouts (55000, #104), on every write path rather than only inside create_event. The price test lives in the trigger WHEN clause, not here; the FLOOR is enforced here and by the events_price_min CHECK, which is the only one of the two that also covers an UPDATE.';

-- create or replace preserves the ACL, so 20260822103819:81's revoke still stands and 0121's #409
-- rule stays green. Restated rather than relied upon, exactly as 20260906141227 restated it: a
-- trigger function reachable by anon is a privilege nobody can use and nobody audits, and the
-- pg_default_acl 'f' row hands it out on every CREATE. Safe for the service-role write path the
-- staging seed depends on — PostgreSQL checks EXECUTE on a trigger function when the TRIGGER is
-- created, not when it fires, and 0147 asserts that service_role still reaches the gate.
revoke execute on function public.enforce_paid_event_gate() from public, anon, authenticated;
