-- #314 follow-up — take the DEFINER function back off the anon path.
--
-- 20260818114947 granted `anon` EXECUTE on athanor.not_banned so the two anon-facing policies
-- could compose it. That violates a standing invariant this repo already asserts:
-- 0080_rls_catalog_sweep test 12, "no SECURITY DEFINER function is executable by anon (or
-- PUBLIC)". The reasoning behind that rule is sound and applies here exactly — Postgres grants
-- EXECUTE to PUBLIC by default, so a DEFINER function reachable by anon is an
-- elevated-privilege endpoint exposed to the unauthenticated internet, and the fact that THIS
-- one only returns a boolean is not the point: the invariant is what stops the next one from
-- being interesting. CI caught it from a zero-replay; staging did not, because staging only ever
-- demonstrated that the anon path WORKED, never that it was ALLOWED.
--
-- The fix is smaller than the original, not larger. `banned_at` is a column on the very row the
-- profiles policies are already testing, so anon needs no function at all — an inline
-- `banned_at is null` is a plain column reference in a USING clause, which is evaluated by the
-- rewriter and never consults anon's column-level SELECT grant (that grant governs a query's
-- target list; anon still cannot NAME banned_at in a select, and 0091 continues to assert it).
--
-- athanor.not_banned survives unchanged for `authenticated`, which is where its DEFINER-ness is
-- actually needed: those policies test OTHER rows (posts.author_id, moments.owner_id, …), so
-- they must read a banned_at the caller cannot reach. That is the same shape, and the same
-- grant posture, as athanor.not_blocked — which 0080 has always been happy with because it is
-- granted to authenticated only.

-- ── 1. drop the grant that broke the invariant ───────────────────────────────────────────────
revoke execute on function athanor.not_banned(uuid) from anon;

comment on function athanor.not_banned(uuid) is
  'Subject-shaped read predicate: is this profile NOT banned (#314). DEFINER because banned_at '
  'has no client grant. True for one''s own uid, so a banned member keeps their own account '
  'view. Keys on banned_at ALONE — a SUSPENDED member stays readable, per 20260813045347''s '
  '"reads stay open on purpose". AUTHENTICATED ONLY: the anon policies inline `banned_at is '
  'null` instead, because 0080 forbids a SECURITY DEFINER function reachable by anon. The '
  'caller-shaped athanor.is_active() is the write-side twin and is not interchangeable with this.';

-- ── 2. anon reads the column directly ────────────────────────────────────────────────────────
-- Same predicate, same effect, no function: the row being tested IS the profile row.
alter policy profiles_select_anon_public on public.profiles
  using (
    coalesce(visibility ->> 'identity', 'public') = 'public'
    and banned_at is null
  );

-- The avatar policy's EXISTS already runs under anon's profiles RLS and would cascade from the
-- policy above on its own; the check stays restated for the reason 20260814151601 gives for
-- restating the visibility predicate here — so it holds even if profiles reachability widens.
-- Without it, a banned member's page 404s and their face still signs.
drop policy if exists "avatars_select_anon_shell" on storage.objects;
create policy "avatars_select_anon_shell" on storage.objects for select to anon
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.profiles p
      where p.id = ((storage.foldername(name))[1])::uuid
        and coalesce(p.visibility ->> 'identity', 'public') = 'public'
        and p.banned_at is null
    )
  );
