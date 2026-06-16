-- Fix a shipped RLS bug: client-side soft-delete was impossible.
--
-- Every soft-deletable table pairs a `select ... using (deleted_at is null)` policy with an
-- `update ... with check (auth.uid() = owner)` policy. PostgreSQL requires an UPDATE's NEW row to
-- remain visible under the table's SELECT policy; setting `deleted_at` makes the new row fail
-- `deleted_at is null`, so the owner's own soft-delete raised `42501 new row violates row-level
-- security policy`. This broke every client soft-delete: delete your own post / comment / moment /
-- tappa / story segment / project, and withdraw your own favor (the app's softDelete* api fns all do
-- a direct authenticated `update set deleted_at`).
--
-- Fix: relax each SELECT policy to ALSO admit the OWNER's own rows, so a soft-deleted new row stays
-- visible to its owner (and ONLY its owner — every other member still sees only `deleted_at is null`).
-- This is safe for reads: every @athanor/api read query already filters `.is('deleted_at', null)`
-- explicitly (defense in depth), so owners never see their own soft-deleted rows in-app — this change
-- only unblocks the UPDATE. pgTAP "invisible to members" assertions check from a NON-owner view and
-- still hold. Owner predicates mirror each table's existing `*_update_own` policy.

alter policy posts_select_authenticated on public.posts
  using (deleted_at is null or author_id = (select auth.uid()));

alter policy post_comments_select_authenticated on public.post_comments
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and exists (
      select 1 from public.posts p
       where p.id = post_comments.post_id and p.deleted_at is null
    )
  );

alter policy moments_select_authenticated on public.moments
  using (deleted_at is null or owner_id = (select auth.uid()));

alter policy dream_milestones_select_authenticated on public.dream_milestones
  using (deleted_at is null or public.owns_dream(dream_id));

alter policy story_segments_select_live on public.story_segments
  using (
    (deleted_at is null or author_id = (select auth.uid()))
    and (expires_at > now() or pinned)
  );

alter policy projects_select_authenticated on public.projects
  using (deleted_at is null or author_id = (select auth.uid()));

alter policy favor_offers_select_party on public.favor_offers
  using (
    (deleted_at is null or (select auth.uid()) = actor_id)
    and ((select auth.uid()) = actor_id or (select auth.uid()) = target_id)
  );
