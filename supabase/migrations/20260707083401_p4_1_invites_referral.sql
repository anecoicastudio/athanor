-- P4.1 — referral chain: profiles.referral_code + invites activations + signup redemption.
-- Ambasciatore (5 activated invites) is a COUNTED composite star (07 §709): invites confer
-- ZERO Aura points and no aura_events type exists for them (rule #1).

-- ── profiles.referral_code — stable per-profile share payload (02 §2.1 Delta A) ─────────
alter table public.profiles add column referral_code text unique;

comment on column public.profiles.referral_code is
  'Stable per-profile invite code; the Ambasciatore (M6) referral source. Generated once server-side by ensure_referral_code(); immutable — NOT in the m7 column-grant list, so clients cannot write it. Joins invites.code.';

-- m7_candidacy column-locked profiles INSERT/UPDATE grants; referral_code is deliberately
-- NOT granted (identity_verified precedent) — no guard trigger needed.

-- ── ensure_referral_code() — idempotent server-side generation (02 §2.1 Delta D) ────────
-- Spec said encode(...,'base32'); Postgres has no base32 — hex uppercased (8 chars) instead.
create function public.ensure_referral_code()
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
  update public.profiles set referral_code = candidate where id = uid;
  return candidate;
end;
$$;

comment on function public.ensure_referral_code() is
  'Set-once referral code for the caller (idempotent). SECURITY DEFINER: referral_code is outside the m7 client column grants, so only this fn (and service_role) can write it.';

revoke execute on function public.ensure_referral_code() from public, anon;
grant execute on function public.ensure_referral_code() to authenticated;

-- ── invites — one row per activation (02 §2.6) ──────────────────────────────────────────
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.profiles (referral_code),
  invitee_id uuid unique references public.profiles (id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invites is
  'Referral activations — one row per invitee who joins via a referral_code. activated_at set ⇒ counted toward Ambasciatore (engine, 07) — ZERO Aura points (rule #1). Written only by handle_new_user (signup path) / service_role.';

create trigger invites_touch_updated_at
  before update on public.invites
  for each row execute function public.touch_updated_at();

create index invites_by_inviter
  on public.invites (inviter_id, activated_at desc nulls last, id desc);

-- RLS: party-read, server-write (00 §4.1 service-role-only-write variant).
revoke all on table public.invites from anon, authenticated;   -- hosted default-priv revoke (14th)
grant select on table public.invites to authenticated;
grant all on table public.invites to service_role;

alter table public.invites enable row level security;

create policy "invites_select_party"
  on public.invites for select
  to authenticated
  using (
    (select auth.uid()) = inviter_id
    or (select auth.uid()) = invitee_id
  );
-- NO client insert/update/delete policies: activations are server-path writes.

-- ── handle_new_user v2 — profile create + referral redemption ───────────────────────────
-- Redemption is fail-open: malformed/unknown/self codes must NEVER break signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_code text;
  ref_inviter uuid;
begin
  insert into public.profiles (id, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'it')
  );

  begin
    ref_code := upper(trim(new.raw_user_meta_data ->> 'referral_code'));
    if ref_code is not null and ref_code <> '' then
      select id into ref_inviter from public.profiles where referral_code = ref_code;
      if ref_inviter is not null and ref_inviter <> new.id then
        insert into public.invites (inviter_id, code, invitee_id, activated_at)
        values (ref_inviter, ref_code, new.id, now())
        on conflict (invitee_id) do nothing;   -- a person is the join of at most one invite
      end if;
    end if;
  exception when others then
    null;  -- referral junk never blocks signup
  end;

  return new;
end;
$$;
