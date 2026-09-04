-- #314 follow-up 2 — the anon avatar policy must not NAME banned_at.
--
-- 20260818123447 replaced athanor.not_banned() with an inline `banned_at is null` in both
-- anon-facing policies. That was right for `profiles_select_anon_public` and wrong for
-- `avatars_select_anon_shell`, and the difference is not a detail:
--
--   • A policy on a table referencing THAT TABLE's own column is fine. anon reads profiles
--     normally with `banned_at is null` in the USING clause, verified on staging.
--   • A policy whose USING clause reaches into ANOTHER table through a subquery has that
--     table's column privileges checked against the QUERYING role. avatars_select_anon_shell
--     lives on storage.objects and subqueries public.profiles, so naming p.banned_at — a
--     column anon deliberately has no grant on (20260813045347 §1, asserted by 0091) — made
--     every anon avatar read fail with
--         42501: permission denied for table profiles
--     for EVERY member, not just banned ones. Caught on staging before this reached CI:
--     `set local role anon; select count(*) from storage.objects where bucket_id='avatars'`
--     went from 14 rows to a hard 42501.
--
-- The previous version avoided this by accident rather than by design: athanor.not_banned() is
-- DEFINER, so it read banned_at with the owner's privileges and the policy only ever NAMED
-- p.id and p.visibility, both of which anon holds. Removing the function removed that cover.
--
-- So the restatement goes, and the policy relies on the cascade instead — which is not a
-- weakening, because it is the same mechanism 20260814151601's own header documents for this
-- exact subquery: "The profiles subquery runs under anon's own RLS (policy §2)". Since
-- 20260818123447, that policy excludes banned members, so the EXISTS already returns false for
-- one. The comment 20260814151601 gave for restating the predicate — so it holds even if
-- profiles reachability widens — cannot be honoured here at any price anon can pay, and the
-- cascade is what remains. 0124 asserts the resulting BEHAVIOUR (anon reads a live member's
-- avatar, and reads nothing for a banned one), which is the guarantee that actually matters.

drop policy if exists "avatars_select_anon_shell" on storage.objects;
create policy "avatars_select_anon_shell" on storage.objects for select to anon
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    -- Names only columns anon holds (id, visibility). The ban is enforced one level down, by
    -- profiles_select_anon_public, which this subquery runs under.
    and exists (
      select 1 from public.profiles p
      where p.id = ((storage.foldername(name))[1])::uuid
        and coalesce(p.visibility ->> 'identity', 'public') = 'public'
    )
  );
