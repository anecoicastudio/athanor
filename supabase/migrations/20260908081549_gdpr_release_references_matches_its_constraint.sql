-- #107 review follow-up to 20260908071656, same PR: `gdpr_release_profile_references` deleted
-- invites by the wrong column.
--
-- The constraint that blocks the account delete is `invites.code → profiles.referral_code`
-- (NO ACTION). The function deleted `where inviter_id = p_profile_id`. Those two sets coincide
-- today — both writers of `invites` set `inviter_id` to the profile that owns `code`, so no row
-- exists whose `code` belongs to somebody other than its own inviter — but nothing asserts that
-- correspondence, and a future writer that breaks it brings back a 23503 that makes `done`
-- unreachable for the affected member, silently and only for them.
--
-- Deleting on BOTH columns makes the function match the constraint it exists to satisfy rather
-- than a proxy for it. It is the same rows today; it stays the right rows if the proxy stops
-- holding.
--
-- `create or replace` preserves the ACL, but the grants are restated anyway — the same
-- precaution 20260821082216 documents, so the intent survives the next replace.

create or replace function public.gdpr_release_profile_references(p_profile_id uuid)
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

  -- Both arms: `inviter_id` is the member's own activations, `code` is the column the blocking
  -- FK actually points at. The subquery rather than a join to profiles because the profiles row
  -- is still there at this point in the cascade — it goes in step (4b), after this.
  delete from public.invites
   where inviter_id = p_profile_id
      or code in (select p.referral_code from public.profiles p
                   where p.id = p_profile_id and p.referral_code is not null);
end;
$$;

comment on function public.gdpr_release_profile_references(uuid) is
  'GDPR erasure, step before the auth.users delete (#107): reassign the two NO ACTION references that are other members'' records (event_attendance.scanned_by, audit_log.actor_id) to the tombstone sentinel and delete the member''s invites — by inviter_id AND by the referral_code the blocking FK points at — so deleting the account raises no 23503. Service-role only; idempotent.';

revoke execute on function public.gdpr_release_profile_references(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_release_profile_references(uuid) to service_role;
