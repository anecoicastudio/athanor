-- #314 — a ban ends presence, not other people's history.
--
-- Ruling (issue #314, 2026-08-18). PR #310 (#106) blocked a banned member's WRITES and left
-- every read surface serving them. This closes the read side:
--
--   anon / public web           /@handle 404s, drops out of the sitemap
--   feed + search               absent, for everyone, members included
--   member-facing profile       tombstone — no display name, no avatar
--   replies inside someone      STAY, attributed to the tombstone
--   else's thread
--
-- The last row is the point. Full removal was considered and REJECTED: it rewrites other
-- members' conversations (a reply vanishing mid-thread, message history developing holes) and
-- it would make a ban indistinguishable from GDPR erasure (#107), which is a separate, stronger
-- mechanism with different legal rules. So `post_comments`, `messages`, `conversations` and the
-- reaction tables are deliberately NOT gated here, and nothing in this migration deletes a row.
--
-- WHY NOW. #251 (PR #367, 20260814151601) made a default shell — handle, display_name, avatar —
-- anon-readable for EVERY profile. Before it most profiles 404d to anon by default and the
-- exposure was partial; now every banned member is guaranteed a public page. #251 grants the
-- shell, a ban revokes it. The two rulings are consistent.
--
-- WHY A NEW PREDICATE AND NOT athanor.is_active(). Two reasons, both blocking:
--   1. SHAPE. is_active() (20260813045347:51) asks about the CALLING member — it reads
--      auth.uid() and takes no argument. The read side asks about the SUBJECT of the row. It is
--      composed only as a restrictive WRITE policy and as the inline guard inside the DEFINER
--      write RPCs; nothing reads through it, which is exactly the gap #314 names.
--   2. MEANING. is_active() is false for a merely SUSPENDED member too. The ruling's table is
--      scoped to BANNED, and 20260813045347's own header is explicit that "reads stay open on
--      purpose — suspended ≠ erased". Gating reads on is_active() would silently hide a
--      suspended member's content from feed and search, which no ruling authorizes.
-- So athanor.not_banned(uuid) keys on banned_at ALONE, and is_active()'s existing composition is
-- left untouched.
--
-- SHAPE COPIED FROM athanor.not_blocked(uuid) (20260619222420) on purpose: same schema, same
-- DEFINER-because-the-column-has-no-client-grant rationale, same "true for one's own uid" escape
-- so an owner keeps their own rows, same composition style (recompose the existing policy under
-- its existing NAME). Keeping the names means 0091's active_write_% counts and every per-table
-- policies_are list keep passing unchanged — this migration adds no policy and drops none.

-- ── 1. the predicate ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because banned_at carries no client SELECT grant in either direction
-- (20260813045347 §1, asserted by 0091). Wrapped-initplan discipline at every call site.
--
-- CASE rather than `or`, so no branch can return NULL into a USING clause: `subject =
-- (select auth.uid())` is NULL for anon, and `NULL or false` is NULL, which a policy treats as
-- deny — correct here by luck rather than by construction. Spelling it out makes the anon path
-- deny for a stated reason. A NULL subject denies outright; every call site passes a NOT NULL
-- column, so that branch is a guard, not a path.
create or replace function athanor.not_banned(subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when subject is null then false
    -- A member is never hidden from themselves: the ban screen (SuspendedNotice) and their own
    -- rows stay reachable. Their WRITES are already denied by the restrictive net (#106).
    when subject = (select auth.uid()) then true
    else not exists (
      select 1 from public.profiles p
       where p.id = subject
         and p.banned_at is not null
    )
  end;
$$;

comment on function athanor.not_banned(uuid) is
  'Subject-shaped read predicate: is this profile NOT banned (#314). DEFINER because banned_at '
  'has no client grant. True for one''s own uid, so a banned member keeps their own account '
  'view. Keys on banned_at ALONE — a SUSPENDED member stays readable, per 20260813045347''s '
  '"reads stay open on purpose". The caller-shaped athanor.is_active() is the write-side twin '
  'and is not interchangeable with this.';

-- anon needs EXECUTE: the anon shell policy below composes it. The athanor schema is not
-- exposed to PostgREST, so this grant creates no RPC surface — and 0121's function-ACL sweep is
-- scoped to schema `public`, so this function owes it no row (athanor.not_blocked sets the same
-- precedent).
revoke execute on function athanor.not_banned(uuid) from public;
grant execute on function athanor.not_banned(uuid) to anon, authenticated;

-- ── 2. profiles — the root of the hiding ─────────────────────────────────────────────────────
-- ANON. One predicate here cascades to most of the public web for free, because these all read
-- the same row through anon's own RLS:
--   • apps/web app/[handle]/page.tsx → getPublicProfileByHandle (createAnonClient) → 404
--   • apps/web app/sitemap.ts        → the handle query drops the row
--   • dreams_select_anon_public / dream_milestones_select_anon_public — both re-check profiles
--     through their own EXISTS subqueries, the cascade 20260814151601's header calls
--     "CONSEQUENCE, DELIBERATE". They are therefore NOT restated here.
alter policy profiles_select_anon_public on public.profiles
  using (
    coalesce(visibility ->> 'identity', 'public') = 'public'
    and athanor.not_banned(id)
  );

-- MEMBERS. Hiding the row is what removes a banned member from search: search_all's person arm
-- is SECURITY INVOKER (20260812111249) and selects straight from public.profiles, so it inherits
-- this policy and needs no change of its own.
--
-- THE ADMIN CLAUSE IS NOT A WIDENING. Today every admin reads profiles as a plain `authenticated`
-- role — there is no admin SELECT policy on this table — and packages/api/src/admin.ts:158 resolves
-- a person report's target_handle with a direct `from('profiles')` read. Without this clause the
-- moderation panel would lose the handle of every member it bans, i.e. banning someone would
-- erase them from the panel that banned them. `or athanor.is_admin()` preserves exactly today's
-- behaviour for admins and nothing more.
alter policy profiles_select_authenticated on public.profiles
  using (
    athanor.not_blocked(id)
    and (athanor.not_banned(id) or athanor.is_admin())
  );

-- ── 3. the feed + search content tables ──────────────────────────────────────────────────────
-- These are the surfaces where a member's own content is DISCOVERED. Each keeps its existing
-- predicate verbatim and appends the ban gate; the `or author_id = auth.uid()` soft-delete escape
-- hatches (20260616083015 / 20260619223725) are preserved, and not_banned is true for one's own
-- uid, so an owner's access to their own rows is unchanged.
--
-- events is deliberately ABSENT from this list even though search_all searches it: an event is a
-- real gathering with other people's tickets and attendance rows, so it falls on the "other
-- people's history" side of the ruling, not the "presence" side.
alter policy posts_select_authenticated on public.posts
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and athanor.not_blocked(author_id)
    and athanor.not_banned(author_id)
  );

alter policy moments_select_authenticated on public.moments
  using (
    (deleted_at is null or owner_id = (select auth.uid()))
    and athanor.not_blocked(owner_id)
    and athanor.not_banned(owner_id)
  );

alter policy story_segments_select_live on public.story_segments
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and (expires_at > now() or pinned)
    and athanor.not_blocked(author_id)
    and athanor.not_banned(author_id)
  );

-- projects carries no not_blocked today (20260616083015) — that is a separate gap, not touched
-- here. search_all's project arm reads this table, so the ban gate belongs on it regardless.
alter policy projects_select_authenticated on public.projects
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and athanor.not_banned(author_id)
  );

-- dreams: the member-facing half. The anon half cascades through profiles (§2); this one does
-- not, because field_visible is a DEFINER helper and reads no profiles row under caller RLS.
-- dream_milestones needs no clause either way: its non-owner branch is
-- `exists (select 1 from public.dreams d …)`, which inherits this policy.
alter policy dreams_select_authenticated on public.dreams
  using (
    deleted_at is null
    and athanor.field_visible(profile_id, 'dream')
    and athanor.not_banned(profile_id)
  );

-- ── 4. storage — the media half ──────────────────────────────────────────────────────────────
-- A hidden row and a readable file is the exact defect 20260808151808 closed for blocks: the
-- descriptor goes and the object stays, reachable by signed URL. Owner derivation, the uuid-shaped
-- guard before the cast, and the deny-on-malformed-key direction are all unchanged from that
-- migration; only the ban gate is added. drop + create rather than alter policy, matching
-- 20260808151808's own style on this table.
drop policy if exists "post-media_select_member" on storage.objects;
create policy "post-media_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "moments_select_member" on storage.objects;
create policy "moments_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
  );

-- story-segments keeps the descriptor-row EXISTS it gained in 20260809151111.
drop policy if exists "story-segments_select_member" on storage.objects;
create policy "story-segments_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'story-segments'
    -- owner uid — the folder, unchanged from 20260808151808
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
    -- this object's own descriptor row, still readable
    and exists (
      select 1 from public.story_segments s
      where s.storage_path = name
        and s.deleted_at is null
        and (s.expires_at > now() or s.pinned)
    )
  );

-- avatars, members side.
drop policy if exists "avatars_select_member" on storage.objects;
create policy "avatars_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
  );

-- avatars, anon side. The EXISTS already runs under anon's profiles RLS and would cascade from
-- §2 on its own; the gate is restated for the reason 20260814151601 gives for restating the
-- visibility predicate here — so this policy stays correct even if profiles reachability widens.
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
        and athanor.not_banned(p.id)
    )
  );

-- ── 5. get_person_profile — the tombstone PROJECTION ─────────────────────────────────────────
-- This is the one place a banned member must still resolve, and the reason the RLS above is not
-- the whole fix.
--
-- The RPC is the shared choke point for the third-person profile screen AND for PostAuthorRow —
-- the author strip on a post or a comment. If a banned member simply stopped resolving here, a
-- surviving reply inside someone else's thread would fall back to memberLabel()'s `null`
-- (packages/core/src/profile/label.ts) and render the generic «·» placeholder, which is what a
-- BLOCKED or deleted author already renders. The ruling asks for a tombstone that reads «account
-- removed», and a tombstone that is indistinguishable from a blocked stranger is not one.
--
-- So the row is RETURNED and the identity is NULLED server-side: handle, display_name and
-- avatar_path go, every visibility-gated field goes with them, the two identity booleans are
-- forced false, and a new `removed` flag tells the client which of "not found" and "removed"
-- it is holding. Nulling here rather than in the client is what makes it enforced: there is no
-- shape of query that returns a banned member's name from this function.
--
-- Zero rows still means "no such person, or blocked" — not_blocked is unchanged and still
-- filters first, so a member who blocked a since-banned member keeps seeing nothing at all
-- rather than being told they were removed.
--
-- drop + create, not `create or replace`: the OUT list changes and Postgres refuses that in
-- place (42P13). Dropping discards the ACL, so the revoke/grant pair is re-issued below —
-- 0080's sweep fails otherwise (the 20260814104755 precedent).
drop function if exists public.get_person_profile(uuid);

create function public.get_person_profile(p_profile_id uuid)
returns table (
  id uuid,
  handle text,
  display_name text,
  avatar_path text,
  bio text,
  mission text,
  identity_tags text[],
  seeking text[],
  skills text[],
  profession text,
  city text,
  founding_member boolean,
  identity_verified boolean,
  removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case when p.banned_at is null then p.handle end,
    case when p.banned_at is null then p.display_name end,
    case when p.banned_at is null then p.avatar_path end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'bio')           then p.bio end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'mission')       then p.mission end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'identity_tags') then p.identity_tags end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'seeking')       then p.seeking end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'skills')        then p.skills end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'profession')    then p.profession end,
    case when p.banned_at is null and athanor.field_visible(p.id, 'city')          then p.city end,
    -- a tombstone wears no badges
    p.banned_at is null and p.founding_member,
    p.banned_at is null and p.identity_verified,
    p.banned_at is not null
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and athanor.not_blocked(p.id);
$$;

comment on function public.get_person_profile(uuid) is
  'Third-person profile projection. bio/mission/identity_tags/seeking/skills/profession/city '
  'arrive NULL when the owner hid them (M10 visibility, absent key = members); display_name '
  'and avatar_path are identity surface and never masked for a visible member (#76); '
  'city_geohash is never projected here at all (#149). Signed-in callers only, blocked pairs '
  'excluded both ways. A BANNED member still resolves, as a tombstone: every identity and '
  'content column NULL, both badges false, removed = true (#314) — so a surviving reply in '
  'someone else''s thread can be attributed to «account removed» rather than to the generic '
  'missing-profile placeholder.';

revoke execute on function public.get_person_profile(uuid) from public, anon;
grant execute on function public.get_person_profile(uuid) to authenticated;
