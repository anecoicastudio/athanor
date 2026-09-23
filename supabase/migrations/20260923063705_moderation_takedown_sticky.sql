-- #788 — a takedown the author can undo is not a takedown.
--
-- admin_takedown (20260923062248) soft-deletes by setting `deleted_at`, the column an author's
-- own delete sets. But `posts_update_own` (20260614162604:58-62) and `post_comments_update_own`
-- (20260614185212:49-53) let the author update ANY column of their row, `deleted_at` included —
-- RELEASE-RUNBOOK §7.8 step 2 already warned of it for the by-hand route: "until the author is
-- banned they can undo a takedown". The restrictive `active_write_update` net stops a banned
-- author only, and a takedown does not always come with a ban: a comment taken down on an email
-- report, a post whose author the moderator warned. One `update posts set deleted_at = null`
-- from the app's own client would put the content back in every feed.
--
-- `messages` carries no client UPDATE at all (20260616123408), so it needs no guard.
--
-- ── the guard ─────────────────────────────────────────────────────────────────────────────
-- A BEFORE UPDATE trigger on posts and post_comments refuses (42501) clearing `deleted_at` on a
-- row that has a 'takedown' row in audit_log — only when the writer is a CLIENT role
-- (`authenticated` / `anon`). Scoped that narrowly on purpose:
--   • an author's OWN soft delete stays reversible by the author, as it is today — the guard
--     keys on the moderation record, not on the column;
--   • the service role and `postgres` pass: refresh-staging.sql revives the seeded posts and
--     comments in place every hour (§3), as postgres, and an operator who reverses a mistaken
--     takedown does it in the SQL editor, as postgres. Neither is a member undoing moderation.
--     The caller is read from `current_setting('role')`, NOT `current_user`: inside this
--     SECURITY DEFINER function `current_user` is the owner (postgres) for every caller, which
--     would let every undo through. The `role` setting is what PostgREST's `set local role`
--     wrote — `authenticated` for every call a member makes, whatever their JWT says — and it
--     reads 'none' for postgres and 'service_role' for the service role (probed on staging).
--
-- Not a column privilege: revoking UPDATE (deleted_at) from authenticated would also take away
-- the author's own delete, which is how the app deletes a post (packages/api).
--
-- SECURITY DEFINER because it reads audit_log, which only an admin can read under RLS
-- (`audit_log_select_admin`) — as an invoker function it would see no takedown for the very
-- member it guards against, and let every undo through. It reads one index probe
-- (`audit_log_target`, 20260923062248) and only on the one transition that matters.
-- A trigger function: EXECUTE revoked from public / anon / authenticated (#409, 0121 asserts it).

create function athanor.guard_takedown_undelete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null and new.deleted_at is null
     and current_setting('role', true) in ('authenticated', 'anon')
     and exists (
       select 1 from public.audit_log a
        where a.action = 'takedown'
          and a.target_type = tg_argv[0]
          and a.target_id = old.id)
  then
    raise exception 'this % was taken down by moderation and cannot be restored', tg_argv[0]
      using errcode = '42501';
  end if;
  return new;
end; $$;

comment on function athanor.guard_takedown_undelete() is
  '#788: BEFORE UPDATE on posts / post_comments. Refuses (42501) a client role clearing '
  'deleted_at on a row audit_log records as taken down (admin_takedown). The author''s own '
  'soft delete stays reversible; service_role / postgres (staging refresh, an operator '
  'reversing a mistake) pass. DEFINER to read audit_log, which RLS shows to admins only. '
  'TG_ARGV[0] is the audit target_type the table''s rows are recorded as.';

revoke execute on function athanor.guard_takedown_undelete() from public, anon, authenticated;

create trigger posts_guard_takedown_undelete
  before update of deleted_at on public.posts
  for each row execute function athanor.guard_takedown_undelete('post');

create trigger post_comments_guard_takedown_undelete
  before update of deleted_at on public.post_comments
  for each row execute function athanor.guard_takedown_undelete('comment');
