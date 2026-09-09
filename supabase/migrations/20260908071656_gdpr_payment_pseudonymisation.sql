-- #107: the erasure job reaches the retained payment tables, and the account can finally be
-- deleted. Implements the controller's 2026-09-07 ruling (#184's closing comment; read
-- supabase/MIGRATIONS-ERRATA.md's last section before trusting any older header's «counsel»):
--
--   * payment rows are PSEUDONYMISED and kept 10 years (art. 2220 c.c.; DPR 600/1973 art. 22) —
--     amount, currency, Stripe ids and timestamps stay, the identity goes,
--   * everything else is deleted on request,
--   * the 10-year reaper that finally drops the pseudonymised rows is a follow-up. Nothing here
--     encodes a window, so there is still no number to invent.
--
-- `fund_contributions` was already done this way by 20260815131925 (#240) and is untouched here.
-- What is left is `event_tickets` and `circle_memberships`, plus the three references that make
-- `auth.users` deletion raise 23503 today.
--
-- ── Why the identity is NULLED and not reassigned to the tombstone sentinel ─────────────────
--
-- The obvious move — reassign to `gdpr_tombstone_profile_id()`, the way the fund reach does —
-- cannot work on these two, and the reason is a unique index rather than a preference:
--
--   event_tickets       unique (user_id, event_id)   → two erased members holding tickets to the
--                                                      same event collide on the second erasure
--   circle_memberships  unique (profile_id)          → the sentinel can hold ONE membership, so
--                                                      the second erased member collides outright
--
-- `fund_contributions` carries neither, which is exactly why the #240 pattern worked there.
--
-- Making those uniques PARTIAL (`where user_id <> gdpr_tombstone_profile_id()`) was the first
-- answer and it is worse than the disease: a partial unique index is only inferable by
-- `ON CONFLICT` if the statement repeats the predicate, and none of the three writers can. Proven
-- against staging — `insert … on conflict (a, b)` against a partial unique raises **42P10, «there
-- is no unique or exclusion constraint matching the ON CONFLICT specification»**. It would have
-- broken, silently at deploy and loudly at the till:
--   * `claim_event_seat`            — `on conflict (user_id, event_id) do update` (20260815072245:84)
--   * the paid-ticket webhook arm   — `onConflict: 'user_id,event_id'` (stripe-webhook/handlers.ts)
--   * the Circle subscription arm   — `onConflict: 'profile_id'`      (stripe-webhook/handlers.ts)
--
-- NULL costs none of that. A unique index is NULLS DISTINCT by default, so any number of erased
-- rows coexist under the UNCHANGED index — `(null, <event>)` never collides with `(null, <event>)`
-- — and every `ON CONFLICT` above keeps inferring the same index it always did. The signal that
-- the sentinel was carrying (this row belonged to somebody, and that somebody is erased) moves to
-- an explicit `erased_at` column, which is a better home for it anyway: it is what the 10-year
-- reaper will key on, and unlike an FK it says WHEN.

-- ── 1. The two payment tables learn to hold a pseudonymised row ────────────────────────────

alter table public.event_tickets
  alter column user_id drop not null,
  add column erased_at timestamptz;

comment on column public.event_tickets.user_id is
  'The buyer, or NULL once the row is pseudonymised by a GDPR erasure (#107). NULL is what keeps unique (user_id, event_id) usable across many erased members: a unique index is NULLS DISTINCT, so the constraint — and every ON CONFLICT that infers it — is unchanged.';
comment on column public.event_tickets.erased_at is
  'When a GDPR erasure pseudonymised this row (#107). NULL for a live ticket. The 10-year retention window of the controller''s 2026-09-07 ruling (#184) is measured from here by the reaper that will drop these rows; nothing encodes that window yet.';

alter table public.circle_memberships
  alter column profile_id drop not null,
  add column erased_at timestamptz;

comment on column public.circle_memberships.profile_id is
  'The member, or NULL once the row is pseudonymised by a GDPR erasure (#107). See event_tickets.user_id: NULL keeps unique (profile_id) — and the webhook''s ON CONFLICT on it — working across many erased members.';
comment on column public.circle_memberships.erased_at is
  'When a GDPR erasure pseudonymised this row (#107). NULL for a live membership. Same 10-year window as event_tickets.erased_at, and the same reaper.';

-- `stripe_customer_id` stays NOT NULL and stays populated: the ruling keeps Stripe ids, and it is
-- unique per customer rather than per erasure, so it collides with nothing. Same for
-- `stripe_subscription_id` and `event_tickets.stripe_payment_id`. `qr_token` is the one thing the
-- function below clears beyond the identity — see its comment.

-- ── 2. The payment reach ───────────────────────────────────────────────────────────────────

-- SECURITY INVOKER, following the gdpr_erase_fund_footprint precedent verbatim (20260815131925:71,
-- restated by 20260821082216 §1): the only caller is the erasure-job's service-role client, which
-- already holds every table this touches, so definer rights would add nothing and would leave a
-- postgres-owned function that can null out money identities — exactly the latent escalation
-- surface rules/supabase-db.md says to avoid.
create function public.gdpr_erase_payment_footprint(p_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_profile_id = public.gdpr_tombstone_profile_id() then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  -- Tickets. The money columns (stripe_payment_id, status, timestamps) and the event link are
  -- kept — the row is the financial record the ruling retains. `qr_token` goes with the identity:
  -- it is a bearer credential for the turnstile, not a financial fact, and a ticket whose owner
  -- has been erased must not still open a door. unique (qr_token) tolerates any number of NULLs.
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
end;
$$;

comment on function public.gdpr_erase_payment_footprint(uuid) is
  'GDPR erasure, retained payment tables (#107, ruling #184): null the identity on event_tickets (and its qr_token) and circle_memberships, stamp erased_at, keep every money column and Stripe id. Pseudonymise, never delete — the 10-year reaper is a follow-up. Service-role only; idempotent.';

revoke execute on function public.gdpr_erase_payment_footprint(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_erase_payment_footprint(uuid) to service_role;

-- ── 3. The references that make auth.users deletion raise 23503 ────────────────────────────

-- Every FK to `public.profiles` is ON DELETE CASCADE or SET NULL except four, and NO ACTION on a
-- referenced row that is going away is an error, not a no-op. Queried against staging rather than
-- recalled:
--
--   fund_contributions.profile_id   RESTRICT   — already handled, gdpr_erase_fund_footprint (#240)
--   event_attendance.scanned_by     NO ACTION  — the organiser who scanned somebody ELSE's ticket
--   audit_log.actor_id              NO ACTION  — the moderator who acted on somebody ELSE's report
--   invites.code → referral_code    NO ACTION  — the member's own referral activations
--
-- The two middle rows are the ones that make `done` unreachable for any member who ever ran an
-- event or moderated a report, and they are not the erased member's personal content: they are
-- another member's check-in and the moderation trail. Both are reassigned to the tombstone
-- sentinel rather than deleted or nulled — deleting destroys somebody else's record, and NULL on
-- `audit_log.actor_id` already means «a system action» (20260815093035:19 dropped its NOT NULL for
-- exactly that), so nulling would file a moderator's decisions under the system's name.
--
-- `invites` is deleted, which is also what the sibling `inviter_id` CASCADE would do — done here
-- explicitly because the two constraints sit on the same table and whether the CASCADE clears the
-- row before the NO ACTION check reads it depends on RI trigger firing order. A guarantee that
-- rests on trigger ordering is not one.
create function public.gdpr_release_profile_references(p_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
begin
  if p_profile_id = v_tombstone then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  update public.event_attendance set scanned_by = v_tombstone where scanned_by = p_profile_id;
  update public.audit_log        set actor_id   = v_tombstone where actor_id   = p_profile_id;
  delete from public.invites where inviter_id = p_profile_id;
end;
$$;

comment on function public.gdpr_release_profile_references(uuid) is
  'GDPR erasure, step before the auth.users delete (#107): reassign the two NO ACTION references that are other members'' records (event_attendance.scanned_by, audit_log.actor_id) to the tombstone sentinel and delete the member''s own invites, so deleting the account raises no 23503. Service-role only; idempotent.';

revoke execute on function public.gdpr_release_profile_references(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_release_profile_references(uuid) to service_role;
