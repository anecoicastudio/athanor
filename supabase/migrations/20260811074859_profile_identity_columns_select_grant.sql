-- #75 follow-up — let members actually READ the name and avatar added in 20260811072211.
--
-- That migration extended the per-column UPDATE and INSERT grants and stopped there, on the
-- assumption that `authenticated` still held a table-level SELECT on profiles. It does not.
-- 20260807170813_m10_profile_visibility_enforcement.sql column-scoped the authenticated SELECT
-- grant down to the non-sensitive set — id, handle, created_at, updated_at, founding_member,
-- identity_verified — and projects everything else (bio, locale, identity_tags, seeking) back
-- out through SECURITY DEFINER accessors that apply profiles.visibility.
--
-- So a column added after that migration is unreadable by every client until it is placed in one
-- tier or the other, and the failure is a flat 42501 "permission denied for table profiles" on
-- any select that names it — which is how this was found: the staging media upload could write
-- avatar_path and could not read it back.
--
-- WHICH TIER. These two go in the DIRECT tier, alongside handle and founding_member, not behind
-- the visibility accessors:
--
--   • They are identity surface, not profile content. handle already sits here, and a name and
--     a face answer the same question handle does — "who is this" — wherever a member appears:
--     a feed row, a comment, a chat bubble, a Momento card. The sensitive tier holds what a
--     member WROTE (bio, tags, seeking); that is the thing PRD §4.2 lets them hide.
--   • Routing them through get_person_profile would not change today's behaviour anyway:
--     athanor.field_visible defaults an ABSENT visibility key to 'members', no profile carries
--     an 'avatar' or 'name' key, and every avatar render site would have to move off a plain
--     select onto the DEFINER accessor to gain nothing.
--
-- If per-field privacy for a name or a photo is ever wanted, that is a real product decision and
-- it belongs in the M10 machinery — a new visibility key plus an accessor projection — not in a
-- grant.
--
-- ANON IS DELIBERATELY EXCLUDED. anon holds (id, handle, visibility, updated_at) for the public
-- @handle pages (20260614153620). Adding a name and a face there would publish every member's
-- photograph to the unauthenticated internet, which is exactly the kind of thing that needs the
-- visibility gate first. The public profile page can render initials until then.
grant select (display_name, avatar_path) on table public.profiles to authenticated;

comment on column public.profiles.avatar_path is
  'Optional storage key in the private `avatars` bucket, shape {uid}/{uid}.{ext}. Rendered through a short-lived signed URL, never a public URL. Nullable by design (#75) — no avatar means initials. Readable by `authenticated` directly (identity tier, like handle); NOT granted to anon.';
