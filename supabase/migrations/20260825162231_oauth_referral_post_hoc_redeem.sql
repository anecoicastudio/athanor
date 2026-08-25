-- #78 — an invite code stashed ahead of a Google/Apple signup was silently lost.
--
-- Referral attribution has only ever had one entry point: `referral_code` inside
-- auth.users.raw_user_meta_data, written by the email signup and redeemed by
-- handle_new_user (20260811072211, born-confirmed) or handle_user_confirmed
-- (20260810135250, confirmations-ON). An OAuth signup carries no such metadata — GoTrue
-- fills raw_user_meta_data from the provider's claims, and supabase-js exposes no channel
-- for our own value on the authorize round trip (auth-js 2.108.1 SignInWithOAuthCredentials
-- offers redirectTo | scopes | queryParams | skipBrowserRedirect, and `state` is GoTrue's
-- own PKCE flow-state). So the code was dropped and the inviter never got the activation.
--
-- Writing the code into user_metadata AFTER the row exists does not work either, and that is
-- worth stating because it is the obvious fix: auth.users carries exactly two triggers
-- (on_auth_user_created, on_auth_user_confirmed `after update of email_confirmed_at`), so a
-- metadata UPDATE fires nothing, and a user born confirmed can never satisfy
-- handle_user_confirmed's `old.email_confirmed_at is null` guard again.
--
-- Hence the second entry point below: a client-CALLABLE RPC that redeems the stash post-hoc,
-- on the first authenticated boot. Client-callable is not client-written. The invitee is
-- derived from auth.uid() and never from an argument, and the row still goes in through
-- athanor.redeem_referral — the same SECURITY DEFINER body both triggers use — so `invites`
-- keeps its server-write-only posture (no client INSERT grant, no INSERT policy) and the
-- Ambasciatore star sweep (20260813120003, invites_star_sweep_ins) fires exactly as before.
--
-- Three gates, because a post-hoc redemption is reachable by an established account in a way
-- the signup triggers never were:
--
--   1. email_confirmed_at must be set. This is the pre-confirmation gaming guard of
--      20260707093739 restated on the new path — otherwise this RPC would be the way around
--      it. On production (mailer_autoconfirm = true) every user is born confirmed, so
--      handle_user_confirmed never fires there and this is the gate that does the work; on
--      staging (confirmations ON) it is the same gate the trigger already applies. A Google
--      signup satisfies it: GoTrue sets email_confirmed_at at INSERT for a provider-verified
--      address (checked against the staging user created by the #77 device walk).
--
--   2. the caller must not already be an invitee. invites.invitee_id is unique and
--      redeem_referral does `on conflict (invitee_id) do nothing`, so re-running is harmless
--      either way; the early return is what keeps a boot from paying for the lookup once a
--      member has been attributed, since the client calls this whenever a stash survives.
--
--   3. the account must be younger than the window below. Without it any member could sign
--      out, open a friend's invite link (invite/[code].tsx stashes only when there is no
--      session), sign back in, and hand that friend an activation — codes traded after the
--      fact, which is precisely what a star that cannot be bought must refuse. The legitimate
--      flow needs seconds: the stash is read on the first authenticated boot, and the account
--      was created moments earlier. Seven days is slack for a member whose first boots failed
--      on a bad network, and it still makes every established account ineligible.
--
-- Every refusal is a silent no-op rather than an error: a referral is a nicety layered on the
-- deep-link → signup flow (apps/native/src/lib/referral.ts), and it must never be the reason
-- a boot surfaces a failure. The one exception is an unauthenticated call, which is a caller
-- bug and raises 42501 — the ensure_referral_code precedent (20260707083401:27).

create function public.redeem_pending_referral(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_created timestamptz;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Junk stash: nothing to look up. Checked before any catalog read.
  if p_code is null or btrim(p_code) = '' then
    return;
  end if;

  -- Gate 2 — a person is the join of at most one invite.
  if exists (select 1 from public.invites where invitee_id = v_uid) then
    return;
  end if;

  select u.created_at, u.email_confirmed_at
    into v_created, v_confirmed
    from auth.users u
   where u.id = v_uid;

  -- Gate 1 — confirmation.
  if v_confirmed is null then
    return;
  end if;

  -- Gate 3 — account age. A null created_at means the age cannot be established, and an
  -- unverifiable age fails closed: the gate exists to refuse accounts that are not new.
  if v_created is null or v_created < now() - interval '7 days' then
    return;
  end if;

  perform athanor.redeem_referral(v_uid, jsonb_build_object('referral_code', p_code));
end;
$$;

comment on function public.redeem_pending_referral(text) is
  'Post-hoc referral redemption for a signup that could not carry the code in user_metadata — every OAuth signup (#78). The invitee is auth.uid(), never an argument. Gated on email confirmation, on the caller not already being an invitee, and on the account being younger than seven days; writes through athanor.redeem_referral, so invites keeps its server-write-only posture and the Ambasciatore star sweep fires unchanged. Silent no-op on every refusal except an unauthenticated call.';

-- #409: a new function is born executable by PUBLIC, and the pg_default_acl 'f' row adds anon
-- and authenticated on top. This one is a real RPC, so authenticated keeps it — but anon is
-- the unauthenticated internet, and PUBLIC is wider still. Same shape as
-- ensure_referral_code (20260707083401:46-47). 0121 pins both sets by name.
revoke execute on function public.redeem_pending_referral(text) from public, anon;
grant execute on function public.redeem_pending_referral(text) to authenticated;
