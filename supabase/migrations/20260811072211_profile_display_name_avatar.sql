-- #75 — profiles gain a name and a face, and the avatars bucket that holds it.
--
-- Until now `public.profiles` carried neither: every member rendered as a circle holding the
-- first letter of their handle (apps/native/src/components/Avatar.tsx). Sign-up has been
-- collecting a name since M0 — (auth)/welcome.tsx:101 puts it in auth.users.user_metadata —
-- and nothing ever read it back, so it was write-only data.
--
-- Product decision (issue #75): name and photo are OPTIONAL. They can be skipped at sign-up and
-- added later from Profilo. @handle stays the primary identity; these two enrich it. Both
-- columns are therefore nullable, and a profile with neither is a first-class state, not a gap.
--
-- This migration is the data layer only. The client surface for viewing and editing them is #76.

-- ── 1. The two columns ────────────────────────────────────────────────────────────────────
-- display_name is length-capped rather than free text so a pathological metadata value cannot
-- push an unbounded string into every feed row. 60 matches nothing enforced client-side today
-- (welcome.tsx caps nothing) — which is exactly why the cap belongs here, and why §2 normalises
-- instead of trusting: a CHECK violation inside handle_new_user aborts the whole signup, the
-- failure mode 20260810135250 was written to close for locale.
alter table public.profiles
  add column display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  add column avatar_path text
    check (avatar_path is null or char_length(avatar_path) <= 512);

comment on column public.profiles.display_name is
  'Optional human name. @handle remains the identity; this enriches it. Nullable by design (#75) — a profile with no name renders as the handle alone.';
comment on column public.profiles.avatar_path is
  'Optional storage key in the private `avatars` bucket, shape {uid}/{uid}.{ext}. Rendered through a short-lived signed URL, never a public URL. Nullable by design (#75) — no avatar means initials.';

-- Column grants. Table-level UPDATE/INSERT were revoked in 20260617225450 and re-granted
-- per-column so identity_verified could stay server-only; every column added since has had to
-- extend those lists (20260620025819 did it for push_enabled). Same here — omitting this would
-- leave the two columns silently unwritable by their owner.
grant update (display_name, avatar_path) on table public.profiles to authenticated;
grant insert (display_name, avatar_path) on table public.profiles to authenticated;

-- ── 2. handle_new_user v5 — stop discarding the name the signup form already collected ────
-- Normalised, not trusted, for the reason in the header: btrim, collapse an empty string to
-- NULL, and hard-truncate to the CHECK's ceiling. After that the CHECK cannot fire, so this
-- can never be the statement that fails a signup. An OAuth provider sends `name` / `full_name`
-- rather than `display_name`, so all three are consulted — Google signups otherwise land with
-- a null name for no reason other than key spelling.
create or replace function athanor.normalize_display_name(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(p_raw, '')), 60), '');
$$;

comment on function athanor.normalize_display_name(text) is
  'Map an arbitrary display-name claim onto a value profiles.display_name accepts: trimmed, empty collapsed to NULL, truncated to 60. Exists so a provider-supplied name can never raise 23514 inside handle_new_user and abort signup.';

revoke execute on function athanor.normalize_display_name(text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, locale, display_name)
  values (
    new.id,
    athanor.normalize_locale(new.raw_user_meta_data ->> 'locale'),
    athanor.normalize_display_name(
      coalesce(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      )
    )
  );

  if new.email_confirmed_at is not null then
    begin
      perform athanor.redeem_referral(new.id, new.raw_user_meta_data);
    exception when undefined_function or insufficient_privilege then
      -- Structural, not data: redeem_referral fail-opens on junk itself. Log rather than
      -- swallow, so a referral path that has stopped working is discoverable.
      raise log 'handle_new_user: athanor.redeem_referral unavailable for %', new.id;
    end;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users INSERT trigger: create the profile row, then redeem a referral when the user is born already-confirmed (confirmations-OFF). Locale and display_name are both normalised, not trusted — a provider claim that violates a CHECK here aborts the entire signup. A missing redeem_referral is logged, never fatal.';

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── 3. The avatars bucket ─────────────────────────────────────────────────────────────────
-- Private, like every other user-media bucket: clients render through short-lived signed URLs
-- (packages/api/src/storage.ts). A public bucket would make every member's face enumerable by
-- uid with no auth at all, and uids are not secret.
--
-- 5 MiB rather than the 50 MiB the media buckets allow. An avatar is a square thumbnail; the
-- cap is the thing that stops a 12 MP camera roll original being stored and then downscaled on
-- every render. Same three image mimes as the other buckets, minus video.
--
-- Path convention: {uid}/{uid}.{ext}. The first segment must be the owner uid — that is what
-- both the owner-write policies and the not_blocked read predicate key on. The second segment
-- repeats it because a profile's entity id IS its uid, so there is no other id to use and a
-- deterministic key lets the seed compute it in SQL. Trade-off: replacing an avatar reuses the
-- key, so a client-side image cache may serve stale bytes until its signed URL expires.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 5242880,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "avatars_update_own" on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'avatars' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using      (bucket_id = 'avatars' and (select auth.uid())::text = (storage.foldername(name))[1]);

-- SELECT mirrors 20260808151808 exactly, including the ordering: the uuid-shaped guard runs
-- BEFORE the cast so a malformed key fails the predicate (denies) instead of raising inside a
-- USING clause and aborting the caller's query. athanor.not_blocked is symmetric and true for
-- one's own uid, so an owner always keeps their own avatar.
create policy "avatars_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
  );

-- ── 4. Bring avatars under the server-side metadata strip ─────────────────────────────────
-- 20260703154523 called this out as a "future one-line WHEN extension". Migrations are
-- append-only, so extending the WHEN clause means dropping and recreating the trigger HERE
-- rather than editing that file. The function body is untouched — it was last redefined by
-- 20260810103721 to read its URL/key through athanor.runtime_setting, and that stands.
--
-- This matters more for avatars than for the other buckets: a face photo straight off a phone
-- carries GPS in EXIF, and an avatar is the one image every member is nudged to upload.
drop trigger if exists media_process_enqueue on storage.objects;
create trigger media_process_enqueue
  after insert or update of version on storage.objects
  for each row
  when (new.bucket_id in ('post-media', 'moments', 'story-segments', 'candidacy-videos', 'avatars'))
  execute function public.enqueue_media_process();
