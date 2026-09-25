-- #784 review follow-up, same PR: two things 20260925154710 made matter that did not before.
--
-- ── 1. One OPEN export job per member ──────────────────────────────────────────────────────
--
-- Until #784 an export job cost one JSON file, so nothing needed to stop a member filing several.
-- Now each job copies the member's whole media library into `exports` and keeps it for seven
-- days, and the insert policy checks ownership and `status = 'requested'`, not uniqueness. A
-- member (or a script with their session) inserting rows straight through PostgREST would get
-- one full library copy per row claimed — up to CLAIM_BATCH a night, each kept a week — and
-- every one of those rows sits ahead of other members' requests in the claim's oldest-first
-- order.
--
-- Fixed at the source, the way 20260908085513 fixed the same shape for erasure requests. The
-- screen already disables the button while a job is open; this makes that true for every caller.
-- PARTIAL on the two open statuses, because a job moves between them (the claim takes
-- 'requested' to 'processing'; a requeue takes it back) and must stay unique across both. Terminal
-- rows are unconstrained: the member's history of ready and failed jobs is theirs to keep until
-- the reap takes it, and re-requesting after a terminal row is the retry path.
--
-- A duplicate insert raises 23505; packages/api's requestExport treats it as success, as
-- requestErasure does — the member asked, and a request is already on file.
--
-- Existing duplicates first, or the index cannot be built. The OLDEST open job per member is
-- kept, since its `created_at` is the member's request; the rest are filed 'failed' rather than
-- deleted — they are the member's rows, and the reap removes a failed row a week later anyway.
-- Both hosted projects held no duplicates when this was written.
update public.gdpr_export_jobs j
   set status = 'failed'
 where j.status in ('requested', 'processing')
   and exists (
     select 1 from public.gdpr_export_jobs older
      where older.profile_id = j.profile_id
        and older.status in ('requested', 'processing')
        and (older.created_at, older.id) < (j.created_at, j.id)
   );

create unique index gdpr_export_jobs_one_open_per_profile
  on public.gdpr_export_jobs (profile_id)
  where status in ('requested', 'processing');

comment on index public.gdpr_export_jobs_one_open_per_profile is
  'One OPEN export job per member (#784): each job copies the member''s media into exports for 7 days, so an unbounded queue per member would multiply storage and starve other requests. Terminal rows are unconstrained. A duplicate insert raises 23505, which packages/api treats as success.';

-- ── 2. A ready row with no expiry is reaped like an expired one ────────────────────────────
--
-- 20260925154710's two reap predicates disagreed on a 'ready' row whose `expires_at` is NULL.
-- `gdpr_export_reap_candidates` protects an object only while `expires_at > now()`, which is not
-- true for NULL — so the object went. `gdpr_export_reap_jobs` deleted ready rows only where
-- `expires_at <= now()`, which is not true for NULL either — so the row stayed, for ever, pointing
-- at an archive that no longer existed. The job never writes such a row (its ready write always
-- carries the expiry), but a hand-written or legacy one would strand exactly that way. Replaced so
-- both sides treat a missing expiry as already expired; the screen reads it the same way.
create or replace function public.gdpr_export_reap_jobs()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with gone as (
    delete from public.gdpr_export_jobs j
     where (j.status = 'ready' and coalesce(j.expires_at, '-infinity'::timestamptz) <= now())
        or (j.status = 'failed' and j.updated_at < now() - interval '7 days')
    returning 1
  )
  select count(*)::int from gone;
$$;

-- `create or replace` keeps the ACL 20260925154710 set; restated so this file reads whole.
revoke execute on function public.gdpr_export_reap_jobs() from public, anon, authenticated;
grant execute on function public.gdpr_export_reap_jobs() to service_role;
