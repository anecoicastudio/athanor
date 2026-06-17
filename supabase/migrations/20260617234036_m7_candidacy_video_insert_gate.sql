-- M7 candidacy review fix: tighten the candidacy-videos INSERT gate.
--
-- The original policy (20260617225450_m7_candidacy.sql §6) gated ONLY on path-ownership
-- (first path segment = caller uid). Because the wizard uploads the ≤200MB mp4 at step 4
-- BEFORE the row insert, an UNVERIFIED user — or any user after the candidacy window closes
-- — could write a video blob that never becomes a candidacy row (the row INSERT is correctly
-- blocked by RLS / is_identity_verified). That is an orphan-blob / storage-abuse gap with no
-- cleanup wired.
--
-- Fix: the video write must satisfy EXACTLY the same precondition as a real candidacy insert
-- — identity-verified AND an open edition window — so a blob can only land if it can become
-- a row. update/delete/select candidacy-video policies are unchanged.
drop policy if exists "candidacy_videos_insert_own" on storage.objects;
create policy "candidacy_videos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidacy-videos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and public.is_identity_verified((select auth.uid()))
    and public.fund_edition_open()
  );
