-- #721 — gdpr-export-job claimed its batch the way erasure-job did before #717, and stranded a
-- job the same way: a SELECT on `status = 'requested'` followed by an UPDATE carrying no
-- predicate at all. A pass torn down between them left the row on 'processing' with nothing in
-- the world still driving it, and two overlapping passes both built, uploaded and signed the same
-- archives. This is #717's fix one surface over — the lease, the atomic claim, and the stamp the
-- caller fences its terminal write on — plus the fourth status that surface needs and erasure
-- already had.
--
-- WHAT IS DELIBERATELY *NOT* COPIED FROM 20260908133119. Erasure de-duplicates its claim per
-- member and takes an advisory lock to serialise that de-duplication. Neither belongs here:
--   * there is no one-open-per-member index on gdpr_export_jobs, so two open jobs for one person
--     are an ordinary state rather than the collision 20260908085513 left behind;
--   * an export is idempotent — the upload is `upsert: true` on a key of {profile_id}/{job.id}.json
--     — so two jobs for one member simply produce two archives, where two erasure passes over one
--     member drive an irreversible cascade twice;
--   * with no per-member rule to serialise, `for update skip locked` alone decides the winner and
--     the advisory lock would guard nothing.
-- `as materialized` stays, for its other reason: it pins the locking scan so the planner cannot
-- re-derive the candidate set — and the row locks with it — underneath the UPDATE.
--
-- THE FOURTH STATUS (ruled by Marco on #721, 2026-09-08). gdpr_export_jobs had no failure value
-- at all, so a job that genuinely cannot be served had nowhere to say so: it either looped on
-- 'requested' every night or sat on 'processing' for ever. That is worse than a missing feature
-- once the lease exists, because the lease re-claims a stranded row nightly — without a terminal
-- failure value, the fix below would convert a row that is stuck into a row that loops. `failed`
-- is terminal: the claim predicate does not reach it, and the member re-requests from the export
-- screen (gdpr.export.failed), which files a fresh 'requested' row.
--
-- The spec (docs/superpowers/specs/2026-06-13-backend-prd/06-schema-fund-circle-trust.md §862-872)
-- also declares only three statuses. The ruling supersedes it; this header is the record, so the
-- next reader does not file the reverse issue.

-- ── the fourth status ───────────────────────────────────────────────────────────────────────
alter table public.gdpr_export_jobs
  drop constraint gdpr_export_jobs_status_check;

alter table public.gdpr_export_jobs
  add constraint gdpr_export_jobs_status_check
  check (status in ('requested', 'processing', 'ready', 'failed'));

-- Rebuilt, not retyped: `comment on table` replaces the WHOLE text, so the sentence added here is
-- appended to 20260620140149's exactly as obj_description returns it.
comment on table public.gdpr_export_jobs is
  'GDPR data-export jobs. Owner requests + reads own status. Backend gdpr-export-job (11) sets processing/ready + signed download_url (expires ≤30d). No client status write. Since #721: ''failed'' is the fourth, terminal status — an archive that cannot be produced or handed over — and the claim runs through claim_export_jobs under a lease.';

-- ── the claim stamp ─────────────────────────────────────────────────────────────────────────
alter table public.gdpr_export_jobs
  add column claimed_at timestamptz;

comment on column public.gdpr_export_jobs.claimed_at is
  'When the current pass took this job (#721). Set by claim_export_jobs together with the ''processing'' status and never cleared, so on a terminal row it is when the pass that finished it began. NULL on a ''processing'' row means the row predates the lease: it is treated as infinitely stale and re-claimed. Distinct from updated_at, which the touch trigger stamps on every write and therefore cannot say when the claim was taken.';

-- The candidate set of every claim, in the order the claim reads it. One partial index rather
-- than the pair erasure carries, because this table has no 'requested' index of its own
-- (gdpr_export_jobs_profile_latest is the screen's, keyed by member) and both arms of the claim
-- predicate are live statuses: everything terminal — 'ready', 'failed' — which is all but a
-- handful of this table, is excluded from it.
create index gdpr_export_jobs_open
  on public.gdpr_export_jobs (created_at, id)
  where status in ('requested', 'processing');

-- ── the atomic claim ────────────────────────────────────────────────────────────────────────
-- ONE statement decides the winner. `for update skip locked` is what makes it a claim rather than
-- a race: a concurrent pass does not block on the locked rows and does not re-read them after the
-- lock clears, it walks past them to rows nobody holds.
--
-- `created_at` is returned alongside the stamp because the loop needs it to decide whether the job
-- is still servable AT ALL: `expires_at <= created_at + interval '30 days'` (20260620140149:16) is
-- a hard constraint, and the job signs its link for SIGNED_TTL_SECONDS (72h), so a job older than
-- 30 days − 72h cannot be written 'ready' without raising 23514. That is exactly the population a
-- stale-claim re-drive serves, which is why the loop fences on the age and files those 'failed'
-- rather than re-claiming them nightly for ever.
create function public.claim_export_jobs(
  p_limit int default 10,
  p_lease interval default interval '15 minutes'
)
returns table (id uuid, profile_id uuid, created_at timestamptz, claimed_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  with candidates as materialized (
    select j.id
      from public.gdpr_export_jobs j
     where (
             j.status = 'requested'
             -- NULL claimed_at is infinitely stale, not «never stale»: a 'processing' row
             -- carrying no stamp was written before the lease existed, and those are the rows
             -- #721 was filed for.
             or (j.status = 'processing'
                 and (j.claimed_at is null or j.claimed_at < now() - p_lease))
           )
     order by j.created_at, j.id
     limit p_limit
     for update skip locked
  )
  update public.gdpr_export_jobs t
     set status = 'processing',
         claimed_at = now()
    from candidates c
   where t.id = c.id
  returning t.id, t.profile_id, t.created_at, t.claimed_at;
$$;

comment on function public.claim_export_jobs(int, interval) is
  'Atomically claim up to p_limit export jobs for one gdpr-export-job pass (#721): every ''requested'' row, plus every ''processing'' row whose claim is older than p_lease or absent. Terminal rows — ''ready'', ''failed'' — are never re-claimed; a member who wants another archive files a new request. Returns the claimed rows with the status already flipped to ''processing'', the created_at the loop measures the 30-day expiry cap against, and the stamp it took, which the caller MUST fence every later status write on — a pass whose lease expired mid-run would otherwise write over a row a later pass now owns. Unlike claim_erasure_requests this does NOT de-duplicate by member: exports are idempotent (upsert on {profile_id}/{job.id}.json) and two jobs for one member are two archives, not a double-drive. p_lease must exceed the edge-function wall clock — 150s free, 400s paid (https://supabase.com/docs/guides/functions/limits) — or a live pass re-claims its own rows; the 15-minute default is 2.25x the paid ceiling. To release a stuck lease by hand, null the row''s claimed_at (RELEASE-RUNBOOK §7.6) — do NOT pass a zero lease, which re-stamps the rows and hides them from the pass you are about to invoke. Service-role only.';

revoke execute on function public.claim_export_jobs(int, interval) from public, anon, authenticated;
grant execute on function public.claim_export_jobs(int, interval) to service_role;

-- ── the lease stamp is not a client's to write ──────────────────────────────────────────────
-- The table's grant is table-level (`select, insert` to authenticated, 20260620140149:32) and a
-- new column inherits it, so without this a member could name their own lease stamp when filing a
-- request — defect 4 of 20260908133119, on the table that migration cited as ITS model. Closed in
-- the policy rather than with a column ACL: gdpr_export_jobs is not one of the seven tables
-- carrying column-level ACLs, and 0121 pins that count.
alter policy "gdpr_export_jobs_insert_own"
  on public.gdpr_export_jobs
  with check (
    (select auth.uid()) = profile_id
    and status = 'requested'
    and download_url is null
    and expires_at is null
    and claimed_at is null
  );
