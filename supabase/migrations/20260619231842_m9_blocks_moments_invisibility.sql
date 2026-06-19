-- M9 blocks: wire moments into the mutual-invisibility matrix (athanor.not_blocked).
-- moments are person-attributable content surfaced on Person-detail (getMomentsPage reads
-- cross-person), and the block.confirm copy promises "momenti" are hidden. The §2A.2 table
-- matrix predates the moments table, so this was missed in the initial 7-table rewire.
-- Preserve the owner soft-delete OR-clause (from 20260616083015_allow_owner_soft_delete.sql)
-- AND add the block check — same shape as posts/post_comments/story_segments.
-- Owner column is `owner_id` (not `author_id` — moments predates the author_id convention).

alter policy moments_select_authenticated on public.moments
  using (
    (deleted_at is null or owner_id = (select auth.uid()))
    and athanor.not_blocked(owner_id)
  );
