-- M2 public-handle-ssr (athanor-reviewer W2 fix): close the anon column-leak.
--
-- The previous migration (20260614144747) granted anon `select` on the WHOLE
-- profiles row whenever ANY section is public, and relied on the @athanor/api
-- read-model to blank members/private columns. But the anon key is public, so a
-- direct Data-API query (e.g. ?select=bio,identity_tags,seeking) bypasses the
-- read-model and leaks members/private profile content. RLS is row-level only —
-- it cannot gate columns. So enforce confidentiality at the trust boundary with a
-- column-level GRANT: anon may read only the non-sensitive columns it needs:
--   id, handle      → public identity (the row is reachable iff a section is public)
--   visibility      → required by the dreams/dream_milestones anon RLS subqueries
--   updated_at      → sitemap lastModified (benign timestamp)
-- bio / locale / identity_tags / seeking stay anon-unreadable.
--
-- Public `bio` (when bio:public) is deferred to a future SECURITY DEFINER RPC that
-- projects only the allowed columns server-side (the proper home for per-section
-- column shaping; lands with the shared athanor.is_visible_to_me predicate, M9).
-- The dreams + dream_milestones anon policies are unaffected: a dream/tappa row is
-- whole-row-public (exposed only when dream:public), so no column leak there.

revoke select on table public.profiles from anon;
grant select (id, handle, visibility, updated_at) on table public.profiles to anon;
