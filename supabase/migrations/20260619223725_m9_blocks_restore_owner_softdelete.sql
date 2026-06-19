-- M9 blocks fix: restore the owner soft-delete OR-clause on posts/post_comments/story_segments
-- that 20260616083015_allow_owner_soft_delete.sql added and the m9_blocks_and_not_blocked rewrite
-- dropped. Without `or author_id = (select auth.uid())` an owner's `update set deleted_at` fails 42501
-- (the shipped P0 from PR #2). Re-add it alongside the not_blocked block check.

alter policy posts_select_authenticated on public.posts
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and athanor.not_blocked(author_id)
  );

alter policy post_comments_select_authenticated on public.post_comments
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and athanor.not_blocked(author_id)
    and exists (
      select 1 from public.posts p
       where p.id = post_comments.post_id and p.deleted_at is null
    )
  );

alter policy story_segments_select_live on public.story_segments
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and (expires_at > now() or pinned)
    and athanor.not_blocked(author_id)
  );
