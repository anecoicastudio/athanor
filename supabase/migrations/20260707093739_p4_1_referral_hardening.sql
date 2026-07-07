-- P4.1 hardening — gate referral activation on email confirmation + fix a code-generation
-- race. Review findings on 20260707083401_p4_1_invites_referral.sql:
--   1. handle_new_user redeemed raw_user_meta_data->>'referral_code' on the auth.users INSERT
--      trigger — i.e. BEFORE email confirmation. Anyone could mint 5 throwaway, never-confirmed
--      signups against their own code and count as an activated Ambasciatore. Redemption must
--      wait for a *confirmed* human, while still working when confirmations are OFF (local/dev,
--      where users are born already-confirmed and no UPDATE-of-email_confirmed_at ever fires).
--   2. ensure_referral_code()'s read-then-write (`select existing` ... `update ... where id`)
--      has a race: two concurrent first calls for the same profile can both pass the
--      `existing is not null` guard as null, mint two different candidates, and both UPDATE —
--      last write wins, and the first caller's returned code is never actually persisted.
--      Fixed via a conditional UPDATE (`... where referral_code is null`) + re-read on conflict.

-- ── athanor.redeem_referral — the redemption body, factored out so it can run from either
-- trigger below (confirmations-ON needs it on confirm; confirmations-OFF needs it on insert).
-- Fail-open: malformed/unknown/self codes must NEVER raise (own begin/exception block).
create or replace function athanor.redeem_referral(p_user_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_code text;
  ref_inviter uuid;
begin
  begin
    ref_code := upper(trim(p_meta ->> 'referral_code'));
    if ref_code is not null and ref_code <> '' then
      select id into ref_inviter from public.profiles where referral_code = ref_code;
      if ref_inviter is not null and ref_inviter <> p_user_id then
        insert into public.invites (inviter_id, code, invitee_id, activated_at)
        values (ref_inviter, ref_code, p_user_id, now())
        on conflict (invitee_id) do nothing;   -- a person is the join of at most one invite
      end if;
    end if;
  exception when others then
    null;  -- referral junk never blocks signup/confirmation
  end;
end;
$$;

comment on function athanor.redeem_referral(uuid, jsonb) is
  'Referral redemption body, factored out of handle_new_user so both the signup trigger (confirmations-OFF, already-confirmed users) and the confirmation trigger (confirmations-ON) can call it. Fail-open. SECURITY DEFINER, trigger-path only — no client ever calls this directly.';

revoke execute on function athanor.redeem_referral(uuid, jsonb) from public, anon, authenticated;

-- ── handle_new_user v3 — profile create unchanged; referral redemption now gated on
-- already-confirmed at insert time (covers confirmations-OFF, where users are born confirmed).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'it')
  );

  if new.email_confirmed_at is not null then
    perform athanor.redeem_referral(new.id, new.raw_user_meta_data);
  end if;

  return new;
end;
$$;

-- ── handle_user_confirmed — the confirmations-ON path: redeem the stashed code the moment
-- a previously-unconfirmed user confirms their email, never before.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform athanor.redeem_referral(new.id, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;

comment on function public.handle_user_confirmed() is
  'Fires when a pending signup confirms their email; redeems any stashed referral_code at that point instead of at raw signup (pre-confirmation-gaming guard, see migration header). Same privilege posture as handle_new_user.';

revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- ── ensure_referral_code() — conditional UPDATE closes the concurrent-first-call race ───────
create or replace function public.ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing text;
  candidate text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select referral_code into existing from public.profiles where id = uid;
  if existing is not null then
    return existing;
  end if;
  loop
    candidate := upper(encode(extensions.gen_random_bytes(4), 'hex'));
    exit when not exists (select 1 from public.profiles where referral_code = candidate);
  end loop;
  update public.profiles set referral_code = candidate where id = uid and referral_code is null;
  if not found then
    select referral_code into existing from public.profiles where id = uid;
    return existing;
  end if;
  return candidate;
end;
$$;
