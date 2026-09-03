-- 20260903083235 re-issued the public.blocks table comment to name list_blocked as the blocker's
-- read channel (#663) — and rebuilt it from the ORIGINAL text in 20260619222420:16-17, not from
-- the current one. 20260821164731:86-89 had since appended the CONVENTION EXEMPTION (#180)
-- sentence that 0128_updated_at_convention asserts on every table without updated_at, so the
-- re-issue silently dropped it and CI's from-zero replay went red on 0128 while every
-- staging smoke stayed green (0128 was not in the adjacent-sweep list). A comment is
-- re-issuable, but only from the comment as it stands: read obj_description() first, never a
-- migration file.
--
-- Re-issued here from the live text, with the #663 sentence kept.

comment on table public.blocks is
  'Blocker CRUD own (immutable: create/delete only). Mutual-invisibility enforced in the read policies of profiles/posts/post_comments/story_segments/momento_proposals/conversations/messages via athanor.not_blocked. pgTAP asserts both directions. The blocker''s own ledger reads the blocked identity through public.list_blocked (DEFINER, blocker_id = auth.uid() only, #663). Zero Aura (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — insert/delete only, as the description already states. Unblocking deletes the row.';
