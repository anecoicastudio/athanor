-- #75 follow-up — close two holes the client UPDATE grant opened on the columns added in
-- 20260811072211. Both are only reachable because that migration granted
-- `update (display_name, avatar_path)` to `authenticated`; the trigger path was already safe.

-- ── 1. avatar_path must point inside its OWN folder ───────────────────────────────────────
-- The bucket policies bind the first path segment to auth.uid(), so a member can only WRITE an
-- object under their own uid. Nothing bound the COLUMN. Since avatars_select_member lets any
-- non-blocked member read any avatar object, a member could set
--   avatar_path = '<someone-else-uid>/<someone-else-uid>.jpg'
-- and wear another member's face everywhere their own is rendered — no upload, no policy
-- violation, one UPDATE of a column they legitimately own. Identity impersonation on a platform
-- whose entire premise is that reputation is earned by a real person.
--
-- split_part rather than storage.foldername: this is a plain text column, the check must be
-- IMMUTABLE-safe, and a key with no '/' yields '' which correctly fails the comparison.
alter table public.profiles
  add constraint profiles_avatar_path_owned
  check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text);

comment on constraint profiles_avatar_path_owned on public.profiles is
  'An avatar key must live under its owner''s uid. Without this a member could point avatar_path at another member''s object and impersonate them, since the read policy is members-wide.';

-- ── 2. display_name: cap the RAW string and trim the whole whitespace class ───────────────
-- 20260811072211 wrote `check (char_length(btrim(display_name)) between 1 and 60)`. Two gaps,
-- both client-only:
--
--   • btrim() defaults to stripping SPACES. `repeat(' ', 5000) || 'x'` trims to 1 character and
--     passes, storing 5001 — the unbounded string that CHECK exists to prevent, in every feed
--     row that renders a name.
--   • A name made only of newlines or tabs does not trim to empty, so it is stored non-null and
--     renders as a blank where a name should be.
--
-- Replaced rather than supplemented so there is exactly one rule to read. Dropping a constraint
-- in a NEW migration is forward evolution, not an edit to an applied one (rule #7).
alter table public.profiles
  drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_shape
  check (
    display_name is null
    or (char_length(display_name) <= 60
        and char_length(btrim(display_name, E' \t\n\r')) between 1 and 60)
  );

comment on constraint profiles_display_name_shape on public.profiles is
  'Raw length <= 60 AND at least one non-whitespace character. The raw bound matters because the trimmed bound alone lets a padded string through, and the client can write this column.';

-- The signup normaliser has to agree with the constraint it feeds, or a provider name made of
-- tabs becomes the 23514 that aborts a signup — the failure 20260810135250 closed for locale.
create or replace function athanor.normalize_display_name(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(p_raw, ''), E' \t\n\r'), 60), '');
$$;

comment on function athanor.normalize_display_name(text) is
  'Map an arbitrary display-name claim onto a value profiles.display_name accepts: whitespace-trimmed (spaces, tabs, newlines, CR), empty collapsed to NULL, truncated to 60. Exists so a provider-supplied name can never raise 23514 inside handle_new_user and abort signup.';
