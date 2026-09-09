-- #717: a request torn down mid-cascade is stranded on 'processing' forever.
--
-- The claim was a read-then-write with no guard at all:
--
--     select id, profile_id from gdpr_erasure_requests where status = 'requested' limit 20;
--     update gdpr_erasure_requests set status = 'processing' where id = $1;   -- no predicate
--
-- Two things follow. First, nothing re-queues a 'processing' row — the claim filters
-- `status = 'requested'` — so an isolate killed between the two statements leaves the request
-- saying «in progress» with nothing in the world still progressing it. The nightly pass walks
-- past it every night thereafter. Second, the unguarded UPDATE means two overlapping passes
-- both select the same twenty rows and both drive the whole cascade; there is no mutual
-- exclusion today, and the cascade's irreversible half is not something to run twice by
-- accident. `pg_cron` fires this once a night so two CRON runs cannot overlap, but §7.5 step 3
-- and §5's verification rider are both a hand-fired `select public.invoke_erasure_job()`, and
-- either can land inside a nightly pass.
--
-- The fix is the one `stripe-webhook` already runs (20260807165936): a claim STAMP plus a lease,
-- and a claim predicate that treats a claim older than the lease as a crashed isolate. Two
-- differences from that model, both forced by this table rather than chosen:
--
--   1. This claim is a BATCH of twenty, not one row addressed by primary key, so the atomic
--      conditional UPDATE cannot be expressed as a PostgREST filter chain. It lives here, as an
--      RPC, which is also what lets pgTAP prove the predicate rather than mirror it.
--   2. It must de-duplicate by profile. 20260908085513's unique index is PARTIAL on
--      `status = 'requested'`, so a stranded 'processing' row does NOT stop the member filing
--      another one — and `packages/api`'s requestErasure treats the 23505 it was meant to raise
--      as success. Widening the claim to 'processing' without de-duplicating would therefore
--      hand ONE batch both of that member's rows and reintroduce, exactly, the bug 20260908085513
--      was written to close: the second row is driven against a uuid the first already deleted,
--      and a fulfilled erasure is filed 'failed'.
--
-- Widening the unique index to cover 'processing' too was the alternative. It is rejected
-- because it cannot be built on a project that already holds both rows for one member — which is
-- precisely the state this migration exists to reconcile — and because de-duplicating at claim
-- time also covers rows written by anything that is not that index.

-- ── the claim stamp ─────────────────────────────────────────────────────────────────────────
alter table public.gdpr_erasure_requests
  add column claimed_at timestamptz;

comment on column public.gdpr_erasure_requests.claimed_at is
  'When the current pass took this request (#717). Set by claim_erasure_requests together with the ''processing'' status and never cleared, so on a terminal row it is when the pass that finished it began. NULL on a ''processing'' row means the row predates the lease: it is treated as infinitely stale and re-claimed. Distinct from updated_at, which the touch trigger stamps on every write and therefore cannot say when the claim was taken.';

-- The 'requested' arm already has gdpr_erasure_requests_pending (20260620140149). This is the
-- 'processing' arm of the same OR — small, because the predicate excludes every terminal row,
-- which is all but a handful of this table.
create index gdpr_erasure_requests_claimed
  on public.gdpr_erasure_requests (claimed_at)
  where status = 'processing';

-- ── the atomic claim ────────────────────────────────────────────────────────────────────────
-- ONE statement decides the winner. `for update skip locked` is what makes it a claim rather
-- than a race: a concurrent pass does not block on the locked rows and does not re-read them
-- after the lock clears, it walks past them to rows nobody holds.
--
-- p_lease is a parameter rather than a constant so §7.5 can force an immediate re-claim
-- (`p_lease => interval '0'`) when an operator KNOWS the isolate is dead, instead of waiting the
-- lease out. The default is the value the job runs with; see the function comment for its floor.
create function public.claim_erasure_requests(
  p_limit int default 20,
  p_lease interval default interval '15 minutes'
)
returns table (id uuid, profile_id uuid)
language sql
security invoker
set search_path = ''
as $$
  with locked as (
    select r.id, r.profile_id, r.created_at
      from public.gdpr_erasure_requests r
     where (
             r.status = 'requested'
             -- NULL claimed_at is infinitely stale, not «never stale». A 'processing' row
             -- carrying no stamp was written by the pre-#717 loop, and those are the rows this
             -- exists to reconcile — `claimed_at < now() - p_lease` alone walks past every one.
             or (r.status = 'processing'
                 and (r.claimed_at is null or r.claimed_at < now() - p_lease))
           )
       -- A LIVE claim on the member blocks every other row of theirs, not just the claimed one.
       -- Without this the de-duplication below is per BATCH only, and the hole it leaves is the
       -- destructive one: a member with a stranded 'processing' row can also hold a 'requested'
       -- row (20260908085513's unique index is partial on 'requested'), so one pass claims the
       -- 'processing' row while a second claims the 'requested' one and both drive the same
       -- account — the two-rows-one-member collision, re-entered through the back door. The
       -- exclusion is written against the LEASE rather than against the status so it releases
       -- itself: once the holder's claim goes stale, the member's rows are claimable again.
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
       -- …and the exclusion above is only as good as the snapshot it reads. Two claims running
       -- at the same instant each see the OTHER's rows unclaimed — `for update skip locked`
       -- protects the row a rival holds, nothing protects the member's OTHER row — so both
       -- would pass the check and drive one account twice. This serialises the CLAIM per member:
       -- the loser takes no lock, matches nothing for that member, and picks them up next pass.
       -- Re-entrant within one transaction, so it does not fight the de-duplication below; held
       -- only for the length of this statement, which is why the lease check above is still the
       -- thing guarding the cascade that runs after the RPC has returned.
       and pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended(
               'gdpr_erasure_requests:' || coalesce(r.profile_id::text, r.id::text), 0))
     order by r.created_at, r.id
     limit p_limit
     for update skip locked
  ),
  -- One row per member per pass. The key is text so a request id can never collide with some
  -- other row's profile_id: a NULL-subject row (the account is already gone, 20260908073545)
  -- keys on its own id and is therefore never de-duplicated away against another one — those
  -- rows are the accountability trace and a pass must be able to close several of them.
  --
  -- Every reference is alias-qualified on purpose: `returns table (id, profile_id)` puts those
  -- two names in scope as OUT parameters of this SQL function, and a bare `id` here would be
  -- ambiguous between the parameter and the CTE column rather than merely unclear.
  deduped as (
    select distinct on (coalesce(l.profile_id::text, 'req:' || l.id::text)) l.id
      from locked l
     order by coalesce(l.profile_id::text, 'req:' || l.id::text), l.created_at, l.id
  )
  update public.gdpr_erasure_requests t
     set status = 'processing',
         claimed_at = now()
    from deduped d
   where t.id = d.id
  returning t.id, t.profile_id;
$$;

comment on function public.claim_erasure_requests(int, interval) is
  'Atomically claim up to p_limit erasure requests for one erasure-job pass (#717): every ''requested'' row, plus every ''processing'' row whose claim is older than p_lease or absent, at most one per member. Returns the claimed rows with the status already flipped to ''processing'' and claimed_at stamped, so a torn-down pass releases its work after the lease instead of stranding it. p_lease MUST exceed the edge-function wall clock — 150s on the free plan, 400s on paid (https://supabase.com/docs/guides/functions/limits) — or a live pass re-claims its own rows; the 15-minute default is 2.25x the paid ceiling. Service-role only; idempotent in the sense that matters, which is that a second concurrent call returns a disjoint set.';

revoke execute on function public.claim_erasure_requests(int, interval) from public, anon, authenticated;
grant execute on function public.claim_erasure_requests(int, interval) to service_role;
