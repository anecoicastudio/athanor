-- Follow-ups to 20260807201350 (review findings). Three gaps in that migration:
--
--   1. It remediated only FUTURE flips. The trigger fires on a TRANSITION into
--      private — deliberately, so a no-op re-save can't keep deleting freshly
--      matched proposals — which means every proposal already stale when it
--      landed is unreachable by it forever. `visibility` has been client-writable
--      since 20260617225450 L17, long before read enforcement arrived, so those
--      rows can exist. One-shot sweep below.
--   2. It watched `visibility` only. Deleting a tag from `identity_tags` /
--      `seeking` is the other, more direct way to un-say it, and both columns are
--      client-writable (same grant). The stored `reasons` kept naming the removed
--      tag with nothing to ever clear it.
--   3. It spared accepted/passed rows entirely (correctly — a conversation hangs
--      off an accepted row, and a passed row carries the 90-day suppression
--      window). But `reasons` stays SELECTable on those rows for the recipient
--      via the column grant + momento_proposals_select_own, forever, even though
--      they never render (getMomentiDeck filters status='pending'). Blanking the
--      text keeps the row and drops the payload.

-- ── 1. One-shot: rows already stale on the visibility axis ──────────────────
-- The tag-REMOVAL axis cannot be swept retroactively: nothing records which tags
-- a profile used to carry, and `reasons` is prose ('Cerchi: music'), not a
-- structured list to diff against. Those rows age out as they are swiped.
delete from public.momento_proposals mp
 using public.profiles p
 where p.id = mp.candidate_id
   and mp.status = 'pending'
   and (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
     or coalesce(p.visibility ->> 'seeking', 'members') = 'private');

update public.momento_proposals mp
   set reasons = '{}'
  from public.profiles p
 where p.id = mp.candidate_id
   and mp.status <> 'pending'
   and mp.reasons <> '{}'
   and (coalesce(p.visibility ->> 'identity_tags', 'members') = 'private'
     or coalesce(p.visibility ->> 'seeking', 'members') = 'private');

-- ── 2 + 3. Widen the trigger ────────────────────────────────────────────────
create or replace function athanor.purge_stale_momento_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hid boolean;
begin
  -- Absent key = 'members' (canonical default, matching athanor.field_visible).
  -- coalesce() can't yield NULL here, so plain <> is enough on the old side.
  -- Tag removal: `old <@ new` is false exactly when something was dropped, so
  -- additions and re-orderings don't churn. Both columns are NOT NULL default
  -- '{}' (20260612204606 L4-5), so no coalesce is needed.
  v_hid :=
       (coalesce(new.visibility ->> 'identity_tags', 'members') = 'private'
        and coalesce(old.visibility ->> 'identity_tags', 'members') <> 'private')
    or (coalesce(new.visibility ->> 'seeking', 'members') = 'private'
        and coalesce(old.visibility ->> 'seeking', 'members') <> 'private')
    or not (old.identity_tags <@ new.identity_tags)
    or not (old.seeking <@ new.seeking);

  if v_hid then
    delete from public.momento_proposals
     where candidate_id = new.id
       and status = 'pending';

    -- Accepted/passed rows survive (conversation, 90-day window) but must not
    -- keep serving the text. Safe against the BEFORE UPDATE triggers on the
    -- table: guard_momento_status_change early-returns when `status` is
    -- unchanged (20260616042201 L73-75), and touch_updated_at just stamps.
    update public.momento_proposals
       set reasons = '{}'
     where candidate_id = new.id
       and status <> 'pending'
       and reasons <> '{}';
  end if;
  return new;
end;
$$;

-- Recreated to carry a WHEN clause: the gate moves out of plpgsql so a handle,
-- bio, locale, push_enabled or identity_verified write never enters the function
-- at all. Must list the tag columns too, now that they are watched.
drop trigger profiles_purge_momenti on public.profiles;
create trigger profiles_purge_momenti
  after update on public.profiles
  for each row
  when (old.visibility is distinct from new.visibility
     or old.identity_tags is distinct from new.identity_tags
     or old.seeking is distinct from new.seeking)
  execute function athanor.purge_stale_momento_proposals();

-- Known trade, recorded because 20260807201350's header framed self-healing as
-- pure upside: deleting the row also frees the matcher's dedupe predicate, so a
-- candidate can cycle private → members and be re-proposed (with a fresh «Hai un
-- Momento» push) on the next 03:11 run. Bounded by the ≤3/day cap, affinity > 0
-- and the block filter, but it does relax "never propose the same pair twice".
-- The recipient also loses an unswiped card mid-session; that is the point.
