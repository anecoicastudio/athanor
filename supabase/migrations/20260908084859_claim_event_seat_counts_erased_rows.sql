-- #107 review follow-up, same PR: `claim_event_seat` stopped counting erased buyers, and an
-- event sold one seat too many for each of them.
--
-- 20260908071656 made `event_tickets.user_id` nullable so a pseudonymised ticket can keep its
-- money without keeping its buyer. This function's capacity count excludes the caller's own row
-- so a re-claim is never double-counted, and it did that with
--
--     and user_id <> v_uid
--
-- `null <> v_uid` is NULL, not true, so every erased buyer's row silently dropped OUT of
-- `v_taken`. The seat is still taken — the ticket row is still there, still `paid`, and
-- `event_seats_taken` (20260812225214) counts it, because it has no caller to exclude and
-- therefore no comparison to go NULL. The two disagreed by exactly one row per erased buyer:
-- the event reads as having a free seat, sells it, and the organiser has more ticket holders
-- than places.
--
-- `is distinct from` is the null-aware form: NULL is distinct from any uuid, so an erased row is
-- counted, and the caller's own row is still excluded. Nothing else about the function changes —
-- the body below is `pg_get_functiondef`'s output for the live function with that one clause
-- replaced, so the #258 claim-pending pre-check, the `for update` arbiter and the re-claim
-- upsert are byte-for-byte what 20260815072245 shipped.
--
-- Grants restated so the intent survives the replace (the 20260821082216 precaution).

CREATE OR REPLACE FUNCTION public.claim_event_seat(p_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_capacity integer;
  v_taken bigint;
  v_status text;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'claim_event_seat: not authenticated';
  end if;
  if not athanor.is_active() then
    raise exception 'claim_event_seat: account suspended or banned' using errcode = '42501';
  end if;

  -- The events row is the arbiter: concurrent claims for one event queue here.
  select capacity into v_capacity
  from public.events
  where id = p_event_id and deleted_at is null
  for update;
  if not found then
    return 'not_found';
  end if;

  -- #258 — a live claim means a payable Session may already exist for this caller: refuse
  -- before the capacity count (a member mid-checkout should hear "you have a purchase in
  -- progress", never "sold out"). NULL expires_at is treated as expired — no writer leaves
  -- a pending row without one, and failing open here would be a permanent lockout.
  select status, expires_at into v_status, v_expires
  from public.event_tickets
  where user_id = v_uid and event_id = p_event_id;
  if found and v_status = 'pending' and v_expires is not null and v_expires > now() then
    return 'claim_pending';
  end if;

  if v_capacity is not null then
    select count(*) into v_taken
    from public.event_tickets
    where event_id = p_event_id
      and user_id is distinct from v_uid  -- the caller's own row is replaced below, never double-counted
      and (status in ('paid', 'checked_in')
           or (status = 'pending' and expires_at > now()));
    if v_taken >= v_capacity then
      return 'sold_out';
    end if;
  end if;

  -- One row per (user, event): a fresh claim, a re-claim of an abandoned/expired one, and a
  -- re-buy after a refund all land on the same row. paid/checked_in rows are untouchable —
  -- the edge function refuses them first ('ticket already owned'), and the WHERE below is
  -- the fail-closed belt when it didn't.
  insert into public.event_tickets (user_id, event_id, status, expires_at)
  values (v_uid, p_event_id, 'pending', now() + interval '35 minutes')
  on conflict (user_id, event_id) do update
    set status = 'pending',
        expires_at = excluded.expires_at,
        stripe_payment_id = null,
        qr_token = null
    where event_tickets.status in ('pending', 'refunded');
  if not found then
    return 'already_owned';
  end if;
  return 'claimed';
end;
$function$;


comment on function public.claim_event_seat(uuid) is
  'Claim a seat on an event, atomically (#105/#258). Capacity excludes the caller''s own row via `is distinct from`, which counts GDPR-pseudonymised tickets whose user_id is NULL (#107) — `<>` silently dropped them and oversold the event by one per erased buyer. SECURITY DEFINER: it arbitrates on the events row.';

revoke execute on function public.claim_event_seat(uuid) from public, anon;
grant execute on function public.claim_event_seat(uuid) to authenticated;
