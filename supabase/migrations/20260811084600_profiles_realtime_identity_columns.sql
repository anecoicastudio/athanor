-- #75 follow-up — restore the invariant 20260807174758 §4 states in prose.
--
-- That migration set the profiles realtime publication to a column list described as "matching
-- the authenticated grant", because Realtime enforces row RLS but the column list is a second
-- lock on the same door. 20260811074859 widened the grant to include display_name and
-- avatar_path and left the publication at six columns, so the sentence became false the moment
-- it landed.
--
-- Nothing broke: publishing FEWER columns than are granted is the safe direction, and
-- 0073_visibility_followups.test.sql kept passing because it asserts an explicit list rather
-- than the correspondence. That is exactly what makes it worth fixing now rather than later — a
-- comment asserting two things agree, with a test that cannot tell when they stop agreeing, is
-- the same shape as the media-process allowlist that silently drifted for a whole migration.
--
-- It is also load-bearing for #76: renaming yourself or changing your photo has to propagate to
-- anyone with your profile on screen, and a column absent from the publication is absent from
-- the payload. Doing it here costs two identifiers; doing it at #76 costs that PR a migration
-- and a staging push it would not otherwise need.
--
-- Still deliberately excluded: bio, locale, identity_tags, seeking, visibility, referral_code,
-- push_enabled — the sensitive tier, which authenticated cannot SELECT and must not receive in
-- a Realtime payload either.
alter publication supabase_realtime drop table public.profiles;
alter publication supabase_realtime add table public.profiles
  (id, handle, display_name, avatar_path, founding_member, identity_verified, created_at, updated_at);
