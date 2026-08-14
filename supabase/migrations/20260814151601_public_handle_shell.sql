-- #251 — the default public shell: a shared @handle link always resolves.
--
-- Ruling (issue #251, 2026-08-14): handle + display_name + avatar are anon-readable BY
-- DEFAULT for every member, through a new `identity` facet in profiles.visibility. Everything
-- else keeps its per-field opt-in — the dream quote explicitly stays opt-in. A member may set
-- the identity facet back to 'members'; control beats the default, and the then-dead link is
-- accepted. PRD §4.14 carve-out landed in c04f82b6 (docs/PRD.md, "minimal public shell").
--
-- WHY THE ROW POLICY IS KEYED ON identity ALONE. The old predicate ("ANY key public") cannot
-- coexist with an anon grant on display_name/avatar_path: column grants are role-wide, RLS is
-- row-level only (20260614153620's own header), so a member who set identity:'members' but
-- left e.g. bio:'public' would still leak name and face through the reachable row. Keying
-- reachability on the identity facet alone closes that: identity:'members' makes the whole
-- row anon-invisible, which is exactly the dead link the ruling accepts.
--
-- CONSEQUENCE, DELIBERATE: dreams/dream_milestones anon policies (20260614144747) reach the
-- owner's profiles row THROUGH profiles RLS, so a member with identity:'members' and
-- dream:'public' now hides their dream from anon too. Coherent — the dream renders on the
-- @handle page, and that page is the thing the member just killed. Members-side reads
-- (get_person_profile, M10) are untouched: the identity facet gates the ANON shell only.
--
-- ABSENT KEY = 'public', not 'members'. athanor.field_visible defaults an absent key to
-- 'members' for CONTENT facets (bio, dream, …) — opt-in. The identity facet is opt-OUT by
-- ruling, so the coalesce here (and in the storage policy below) must default the other way.
-- The column default + backfill make the key present everywhere anyway; the coalesce guards
-- the one path that can still produce an absent key — an older client replacing the whole
-- visibility map without an identity entry (profileUpdateSchema sends the full record). Such
-- a write falls back to the DEFAULT, it does not flip the member out of the shell silently.

-- ── 1. Default + backfill ─────────────────────────────────────────────────────────────────
alter table public.profiles
  alter column visibility set default '{"identity": "public"}'::jsonb;

-- All members, not just new signups. `||` preserves every existing key; the `?` guard means
-- an explicit identity choice (none exist today, but the guard is the contract) is respected,
-- never overwritten. The touch trigger will bump updated_at on backfilled rows — benign, the
-- sitemap's lastModified moves once.
update public.profiles
  set visibility = visibility || '{"identity": "public"}'::jsonb
  where not (visibility ? 'identity');

-- ── 2. Anon row policy: reachability = the identity facet ─────────────────────────────────
-- Same policy name, new predicate — 0001/0007 assert the policy list by name.
drop policy "profiles_select_anon_public" on public.profiles;
create policy "profiles_select_anon_public"
  on public.profiles for select
  to anon
  using (coalesce(visibility ->> 'identity', 'public') = 'public');

-- ── 3. The shell columns ──────────────────────────────────────────────────────────────────
-- anon previously held (id, handle, visibility, updated_at) — 20260614153620. The shell adds
-- the name and the face. bio / locale / identity_tags / seeking / mission / skills /
-- profession / city / city_geohash stay anon-unreadable: the shell is exactly three fields,
-- and a Data-API select naming anything else keeps failing with 42501.
grant select (display_name, avatar_path) on table public.profiles to anon;

comment on column public.profiles.avatar_path is
  'Optional storage key in the private `avatars` bucket, shape {uid}/{uid}.{ext}. Rendered through a short-lived signed URL, never a public URL. Nullable by design (#75) — no avatar means initials. Readable by `authenticated` directly (identity tier, like handle) and by `anon` for members whose identity facet is public — the #251 default shell.';

-- ── 4. Storage: anon may read a shell member's avatar ─────────────────────────────────────
-- The grant-half of #288 (the render-half — the web <img> pipeline — stays there). A column
-- grant nobody can render is not a shell: the bucket is private and until now only
-- `avatars_select_member` (authenticated) could read it, so the anon key could not sign a
-- URL. Mirrors avatars_select_member's shape: the uuid guard runs BEFORE the cast so a
-- malformed key fails the predicate (denies) instead of raising inside USING. The profiles
-- subquery runs under anon's own RLS (policy §2) — the explicit predicate restates it so this
-- policy stays correct even if profiles reachability ever widens.
create policy "avatars_select_anon_shell" on storage.objects for select to anon
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.profiles p
      where p.id = ((storage.foldername(name))[1])::uuid
        and coalesce(p.visibility ->> 'identity', 'public') = 'public'
    )
  );
