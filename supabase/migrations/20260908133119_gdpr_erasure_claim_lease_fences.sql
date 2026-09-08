-- #717 review follow-up, same PR: three defects in 20260908130546's claim, and one in the
-- INSERT policy it left untouched. Its own function comment is superseded here and the
-- correction is recorded in supabase/MIGRATIONS-ERRATA.md, since that file is applied and frozen.
--
-- 1. THE ADVISORY LOCK WAS TAKEN FOR EVERY CANDIDATE ROW, NOT FOR THE ONES CLAIMED.
--    It sat in the WHERE of the query carrying `order by … limit p_limit`, so it was evaluated
--    at the scan, below the limit. Two consequences, and the second is the serious one:
--      (a) the function's comment claimed «a second concurrent call returns a disjoint set».
--          It did not. The first call had already locked every eligible member in the table, so
--          an overlapping hand-fired pass got NOTHING rather than the rest of the queue.
--      (b) on a backlog — precisely the state the lease exists to reconcile — one call took an
--          advisory lock per candidate row in a single transaction, which is how you reach
--          `out of shared memory / increase max_locks_per_transaction`. The claim would then
--          500 exactly when the queue is longest, and erasure stops altogether.
--    Moved into the de-duplication step, which runs above the limit, so at most `p_limit` locks
--    are ever held. `as materialized` pins that: it stops the planner inlining the candidate
--    scan and re-deriving the volatile qual underneath the LIMIT.
--
-- 2. THE LOOP COULD NOT FENCE ITS TERMINAL WRITE, because the claim did not hand back the stamp
--    it took. `stripe-webhook` guards both its release and its completion with
--    `.eq('claimed_at', ourClaim)` (handlers.ts:916-938) and that half of the model was not
--    copied. Without it, a pass whose lease expires mid-cascade — an unusually long run, or an
--    operator releasing the lease by hand — writes 'done' or 'failed' over a row a SECOND pass
--    now owns, taking it out of 'processing' while that pass is still working it, and neither
--    side can tell. `claimed_at` is returned so the caller can fence on it.
--
-- 3. THE LOCK KEY AND THE DE-DUPLICATION KEY DISAGREED. 20260908130546 argued the `'req:'`
--    namespace was needed so a request id could never collide with another row's profile_id,
--    then omitted it from the lock key. Nil probability with random UUIDs, but one of the two
--    spellings had to be wrong; they are now the same expression.
--
-- 4. `claimed_at` WAS CLIENT-WRITABLE ON INSERT. The table's grant is table-level
--    (`SELECT,INSERT` to authenticated, 0121:120) and a new column inherits it, so a member
--    could name their own lease stamp when filing a request. Harmless as the predicate stands —
--    it only reads `claimed_at` on 'processing' rows, which the same policy stops a client
--    creating — but lease state is not a client's to write, and a later predicate would make it
--    matter. Closed in the policy rather than with a column ACL: `gdpr_erasure_requests` is not
--    one of the seven tables carrying column-level ACLs, and 0121 pins that count.

-- ── the claim, with the lock above the limit and the stamp handed back ──────────────────────
-- Dropped rather than replaced: `create or replace function` cannot change a return type.
drop function public.claim_erasure_requests(int, interval);

create function public.claim_erasure_requests(
  p_limit int default 20,
  p_lease interval default interval '15 minutes'
)
returns table (id uuid, profile_id uuid, claimed_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  with candidates as materialized (
    select r.id, r.profile_id, r.created_at
      from public.gdpr_erasure_requests r
     where (
             r.status = 'requested'
             -- NULL claimed_at is infinitely stale, not «never stale»: a 'processing' row
             -- carrying no stamp was written before the lease existed, and those are the rows
             -- #717 was filed for.
             or (r.status = 'processing'
                 and (r.claimed_at is null or r.claimed_at < now() - p_lease))
           )
       -- A live claim on the member holds back every other row of theirs. 20260908085513's
       -- unique index is partial on 'requested', so a stranded 'processing' row never stopped
       -- the member filing a second request beside it, and claiming both would drive one
       -- account twice.
       and not exists (
         select 1
           from public.gdpr_erasure_requests live
          where live.profile_id is not null
            and live.profile_id = r.profile_id
            and live.id <> r.id
            and live.status = 'processing'
            and live.claimed_at is not null
            and live.claimed_at >= now() - p_lease
       )
     order by r.created_at, r.id
     limit p_limit
     for update skip locked
  ),
  -- The exclusion above is only as good as the snapshot that read it: two claims at the same
  -- instant each see the other's rows unclaimed, and `for update skip locked` protects the row
  -- a rival holds but not the member's OTHER row. This serialises the claim per member — the
  -- loser takes no lock and drops that member until the next pass. It is HERE, above the limit,
  -- so a backlog cannot turn one claim into thousands of advisory locks.
  --
  -- Same key expression as the de-duplication it sits with, `'req:'` namespace included, so a
  -- subject-less row locks on its own identity and never against another row's profile.
  deduped as (
    select distinct on (coalesce(c.profile_id::text, 'req:' || c.id::text)) c.id
      from candidates c
     where pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended(
               'gdpr_erasure_requests:' || coalesce(c.profile_id::text, 'req:' || c.id::text), 0))
     order by coalesce(c.profile_id::text, 'req:' || c.id::text), c.created_at, c.id
  )
  update public.gdpr_erasure_requests t
     set status = 'processing',
         claimed_at = now()
    from deduped d
   where t.id = d.id
  returning t.id, t.profile_id, t.claimed_at;
$$;

comment on function public.claim_erasure_requests(int, interval) is
  'Atomically claim up to p_limit erasure requests for one erasure-job pass (#717): every ''requested'' row, plus every ''processing'' row whose claim is older than p_lease or absent, at most one per member. Returns the claimed rows with the status already flipped to ''processing'' and the stamp it took, which the caller MUST fence its terminal write on — a pass whose lease expired mid-cascade would otherwise write over a row a later pass now owns. p_lease must exceed the edge-function wall clock — 150s free, 400s paid (https://supabase.com/docs/guides/functions/limits) — or a live pass re-claims its own rows; the 15-minute default is 2.25x the paid ceiling. Two overlapping calls never return the same row, and never return two rows of one member; a caller that loses the race for a member simply does not see them this pass. To release a stuck lease by hand, null the row''s claimed_at (RELEASE-RUNBOOK §7.5) — do NOT pass a zero lease, which re-stamps the rows and hides them from the pass you are about to invoke. Service-role only.';

revoke execute on function public.claim_erasure_requests(int, interval) from public, anon, authenticated;
grant execute on function public.claim_erasure_requests(int, interval) to service_role;

-- ── the lease stamp is not a client's to write ──────────────────────────────────────────────
-- Same shape as gdpr_export_jobs' insert policy, which pins download_url and expires_at to NULL
-- for exactly this reason: a column the backend owns must be unset at the door, not merely
-- overwritten later.
alter policy "gdpr_erasure_requests_insert_own"
  on public.gdpr_erasure_requests
  with check (
    (select auth.uid()) = profile_id
    and status = 'requested'
    and claimed_at is null
  );
