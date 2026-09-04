-- #663 — the blocked-profiles list shows «—» and an anonymous avatar for every blocked person.
--
-- athanor.not_blocked(uuid) is SYMMETRIC (20260619222420:52-64): it is false when a block exists
-- in either direction. profiles_select_authenticated composes it (latest form 20260818114947:109-
-- 113), so the BLOCKER loses SELECT on the blocked person's profiles row — and listBlocked's
-- PostgREST embed `blocked:profiles!blocks_blocked_id_fkey(handle, display_name, avatar_path)`
-- comes back NULL. The block row itself survives (blocks_select_own), so the screen renders a
-- row it cannot name. avatars_select_member gates on the same predicate, so the face does not
-- sign either.
--
-- WHY NOT WIDEN THE POLICY. A one-directional `or <caller blocks this row>` on
-- profiles_select_authenticated would fix the embed, but the policy is inherited by every
-- profiles read in the app: search_all's person arm is SECURITY INVOKER on profiles
-- (20260818114947:98-100), so blocked people would reappear in the blocker's search results,
-- and every other embed (post authors, conversation partners, momento candidates) would resolve
-- them again. §2B-08 mutual invisibility is the product promise; 0050 asserts it both ways and
-- stays untouched. The blocked-profiles ledger is the ONE surface that legitimately needs the
-- identity, so it gets its own channel — the same shape the ban gate took in the same policy
-- (`or athanor.is_admin()`, 20260818114947:102-107): an escape for one reader, not a widening.
--
-- ── 1. list_blocked — the caller's own block ledger, resolved ────────────────────────────────
--
-- SECURITY DEFINER because that is the whole point: the profiles policy hides the row and this
-- function reads through it. Bounded by the only ownership predicate that can ever appear here,
-- `b.blocker_id = (select auth.uid())` — the OTHER direction (rows where the caller is the
-- blocked party) never joins, so the blocked party learns nothing (0049's guarantee, restated in
-- 0143). search_path is locked; execute is revoked from public/anon and granted to
-- authenticated (0080 / 0121). Keyset (created_at desc, id desc) with the cursor's two halves
-- required together — `IF <null>` does not run in plpgsql, so the guard compares two null-tests
-- rather than gating on a value (the 20260821085655 shape, and the 20260815093035 erratum).
--
-- A BANNED blocked person still lists — the row is the blocker's ledger, getBlockedCount counts
-- raw rows, and a ghost block that cannot be unblocked is worse than a tombstone — but as the
-- #314 tombstone get_person_profile already projects (20260818114947:257-299): identity NULL,
-- removed = true. There is no shape of query that returns a banned member's name from this
-- function either.
--
-- No new index: the `blocker_id =` filter is served by blocks_pair (blocker_id, blocked_id),
-- and a member's ledger is a handful of rows — the (created_at, id) sort on that handful is not
-- load-bearing. Revisit if a ledger ever pages.

create function public.list_blocked(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  blocked_id uuid,
  created_at timestamptz,
  handle text,
  display_name text,
  avatar_path text,
  removed boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Belt and braces: anon holds no EXECUTE, but a DEFINER body never trusts that alone.
  if (select auth.uid()) is null then
    return;
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'blocked-list cursor needs both created_at and id' using errcode = '22023';
  end if;
  return query
    select
      b.id,
      b.blocked_id,
      b.created_at,
      case when p.banned_at is null then p.handle end,
      case when p.banned_at is null then p.display_name end,
      case when p.banned_at is null then p.avatar_path end,
      p.banned_at is not null
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
    where b.blocker_id = (select auth.uid())
      and (p_before_created_at is null
           or (b.created_at, b.id) < (p_before_created_at, p_before_id))
    order by b.created_at desc, b.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end; $$;

comment on function public.list_blocked(integer, timestamptz, uuid) is
  'The caller''s own block ledger resolved to the blocked person''s identity (#663). SECURITY '
  'DEFINER because profiles_select_authenticated composes the SYMMETRIC athanor.not_blocked, '
  'which hides the blocked row from the BLOCKER too; the policy is unchanged (0050 holds both '
  'ways) and this is the one channel that reads through it, scoped to blocker_id = auth.uid() so '
  'the blocked party learns nothing (0049). Keyset (created_at desc, id desc), cursor both halves '
  'or 22023 (rule #9). A BANNED blocked person still lists, as the #314 tombstone: identity NULL, '
  'removed = true — mirroring get_person_profile.';

revoke execute on function public.list_blocked(integer, timestamptz, uuid) from public, anon;
grant execute on function public.list_blocked(integer, timestamptz, uuid) to authenticated;

-- The table comment named the read policies as the whole enforcement story. Still true; now
-- incomplete without the ledger channel. Comments are re-issuable (20260818114947:70-75).
comment on table public.blocks is
  'Blocker CRUD own (immutable: create/delete only). Mutual-invisibility enforced in the read policies of profiles/posts/post_comments/story_segments/momento_proposals/conversations/messages via athanor.not_blocked. pgTAP asserts both directions. The blocker''s own ledger reads the blocked identity through public.list_blocked (DEFINER, blocker_id = auth.uid() only, #663). Zero Aura (rule #1).';

-- ── 2. avatars_select_member — the blocker may still sign the face they blocked ──────────────
--
-- The list needs the photo as much as the name. The read policy keeps not_blocked on the
-- OBJECT'S OWNER (0086 asserts that exact spelling — applied to the caller's own uid it is a
-- tautology) and gains a one-directional escape: the caller holds a blocks row naming this
-- owner. The EXISTS runs under the caller's own blocks RLS (blocks_select_own: blocker_id =
-- auth.uid()), so on the blocked party's side it is always false — nothing opens the other way,
-- and no new DEFINER helper is needed. `authenticated` holds SELECT on public.blocks
-- (20260619222420:25), which the column-privilege check a storage policy runs on its subqueries
-- requires (20260818123711:9-17). not_banned stays OUTSIDE the or: a banned blocked person's
-- face does not sign, consistent with the NULL avatar_path the RPC projects.
--
-- drop + create, not `alter policy`: the convention for storage.objects (20260818114947:168-169).

drop policy if exists "avatars_select_member" on storage.objects;
create policy "avatars_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      athanor.not_blocked(((storage.foldername(name))[1])::uuid)
      or exists (
        select 1 from public.blocks b
        where b.blocker_id = (select auth.uid())
          and b.blocked_id = ((storage.foldername(name))[1])::uuid
      )
    )
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
  );
