-- Review follow-up to 20260821075230_story_segment_bytes_reaper.sql (#31), same PR.
--
-- Two corrections to functions that migration created. Its HEADER carries the matching
-- prose errors; those are recorded in supabase/MIGRATIONS-ERRATA.md, because an applied
-- migration is never edited (rule 7) — it had already reached staging when review found them.
--
-- 1. `story_segment_reap_candidates` goes back to SECURITY INVOKER.
--    The definer rationale 20260821075230 gave ("joins a table whose own policy would otherwise
--    hide the expired rows") does not hold for the function's only grantee: service_role carries
--    BYPASSRLS and SELECT on both storage.objects and public.story_segments, so invoker returns
--    identical rows. That is exactly the gdpr_erase_fund_footprint precedent (20260815131925,
--    "definer rights would add nothing"). rules/supabase-db.md: SECURITY DEFINER only when
--    genuinely required, and a DEFINER function whose rationale no longer holds goes back to
--    invoker — a postgres-owned definer that enumerates storage.objects across every owner
--    folder is a latent escalation surface the moment a grant widens, and it is what the next
--    author would copy. Grants are restated so the intent survives a `create or replace`.
--
-- 2. `prune_expired_story_segments()` guards the pg_net half.
--    Its body ran the row soft-delete and the reaper post in ONE plpgsql block, so an exception
--    from the post — pg_net disabled in the dashboard (3F000, schema "net" does not exist), a
--    future change to athanor.edge_auth_headers — would have rolled back the nightly row prune
--    that 20260614230935 ran standalone until now, and kept rolling it back every 03:17 until
--    somebody read cron.job_run_details. The post now sits in its own `begin … exception`
--    block and degrades to a WARNING: the shape enqueue_media_process and
--    star_sweep_invite_activated already use for a post that rides on DML. The `is null`
--    guard still covers "unconfigured"; this covers "configured and broken".
--
-- The predicate itself is unchanged. One note on it belongs here because the first header
-- omits it: the storage SELECT policy it inverts has THREE viewer-side arms, not two — the
-- owner-folder regex, athanor.not_blocked AND athanor.not_banned (the last added by
-- 20260818114947). None is mirrored, all for the same reason: they are about who may READ,
-- not about whether the segment is alive. A banned author's live or pinned segment keeps its
-- bytes («a ban ends presence, not history», 20260818114947) exactly as a blocked author's
-- does; pgTAP 0126 now checks the candidate set against the REAL policy as a member, not
-- against a hand-typed copy of its predicate, so a fourth arm cannot drift the two apart
-- unnoticed.

create or replace function public.story_segment_reap_candidates(
  p_limit integer default 1000,
  p_grace interval default interval '1 hour'
) returns table (name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'story-segments'
     and o.created_at < now() - p_grace
     and not exists (
       select 1
         from public.story_segments s
        where s.storage_path = o.name
          and coalesce(s.deleted_at, 'infinity'::timestamptz) > now() - p_grace
          and (s.pinned or s.expires_at > now() - p_grace)
     )
   -- Oldest first: the backlog drains in the order it accumulated.
   order by o.created_at, o.name
   -- Clamped to the Storage API's per-call ceiling (1000) so the edge function can pass its
   -- batch size straight through, and to ≥ 1 so a zero never means "everything".
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.story_segment_reap_candidates(integer, interval) is
  'Objects in story-segments with no descriptor row live or pinned within p_grace (#31): the storage SELECT policy''s descriptor predicate inverted, with a margin. Oldest first, ≤ 1000. Invoker: read by the story-segment-reaper edge function as service_role, which needs no definer rights. The deletion goes through the Storage API, never this table.';

revoke execute on function public.story_segment_reap_candidates(integer, interval)
  from public, anon, authenticated;
grant execute on function public.story_segment_reap_candidates(integer, interval) to service_role;

create or replace function public.prune_expired_story_segments() returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.story_segments
     set deleted_at = now()
   where deleted_at is null
     and pinned = false
     and expires_at <= now();

  -- pg_net queues the request and sends it after this transaction commits, so the reaper sees
  -- the rows soft-deleted above — though with the 1 h grace it reaps tonight the segments that
  -- EXPIRED before 02:17, and tomorrow the ones this pass just caught.
  --
  -- Guarded: a failure to POST must never roll back the prune above. The row side is the
  -- older, load-bearing half; the bytes can wait a night, the rows should not.
  begin
    perform public.invoke_story_segment_reaper();
  exception when others then
    raise warning 'prune_expired_story_segments: reaper post failed, rows pruned anyway: % (%)',
      sqlerrm, sqlstate;
  end;
end;
$$;

comment on function public.prune_expired_story_segments() is
  'Nightly (03:17): soft-deletes expired, unpinned story segments (rows), then asks the story-segment-reaper to free the bytes of everything hidden for over an hour (#31). The post is exception-guarded so it can never roll back the prune. Cron-only (postgres ctx).';

revoke execute on function public.prune_expired_story_segments() from public, anon, authenticated;
