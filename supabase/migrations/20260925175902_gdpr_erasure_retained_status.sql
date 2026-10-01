-- #735, item 2 — an erasure the Stripe cancel blocked is RETAINED and retried, not failed and
-- forgotten.
--
-- erasure-job's (3b-bis) already blocks the cascade when the member's Circle subscription could
-- not be stopped (#107/#717): a failed status read, a failed cancel or a deployment with no
-- Stripe key sets `cascadeSafe = false`, and (3c)/(3d)/(4) are skipped so the account stays. What
-- it then wrote was 'failed' — a TERMINAL status that claim_erasure_requests never re-claims.
-- The member stayed banned for ever (the sticky ban keys on `status <> 'done'`), the card went
-- on being charged, and only a reader of the function logs could know either.
--
-- 'retained' names that state: the account is kept on purpose because something outside the
-- database — Stripe — still holds a live obligation, and the next nightly pass tries again. The
-- claim below re-takes 'retained' rows exactly as it takes 'requested' ones, so the retry needs
-- no operator. RELEASE-RUNBOOK §7.5's hand cancel is the fallback for a row that stays retained.
--
-- Deliberately NOT extended to 'failed': a failed storage sweep or reference release has no
-- outside party to wait on, and re-driving it nightly would repeat the same error with nobody
-- told. Those stay R-8 §7.5's by hand.
--
-- Everything that reads «open request» already reads `status <> 'done'` — athanor.is_active(),
-- gdpr_keep_erasure_ban(), the partial index gdpr_erasure_requests_open_by_profile — so a
-- retained member stays locked out and banned with no change to any of them. The claim's
-- retained → processing flip is an UPDATE from a non-'done' status, which
-- gdpr_ban_on_erasure_request() returns from before touching auth.users (20260910140902).
--
-- Client surface unchanged: the insert policy pins `status = 'requested'` and there is no client
-- UPDATE grant, so 'retained' is reachable only by the service-role job.

alter table public.gdpr_erasure_requests drop constraint gdpr_erasure_requests_status_check;
alter table public.gdpr_erasure_requests add constraint gdpr_erasure_requests_status_check
  check (status in ('requested','processing','done','partial','failed','retained'));

comment on column public.gdpr_erasure_requests.status is
  'requested → processing → done | failed | retained. ''retained'' (#735) = the cascade stopped before the money steps because the member''s Circle subscription is still live in Stripe; the account is kept and the next pass re-claims the row. ''failed'' = a step failed with no outside party to wait on; re-driven by hand (RELEASE-RUNBOOK §7.5). ''partial'' is historical (#515) and no longer written. Written ONLY by the service-role erasure-job; clients may insert ''requested'' and nothing else.';

-- Same body as 20260908133119 but for the one predicate line: 'retained' is claimable. The
-- return type is unchanged, so this is a replace, not a drop — privileges survive, and are
-- restated below anyway so this file alone says who may call it.
create or replace function public.claim_erasure_requests(
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
             r.status in ('requested', 'retained')
             or (r.status = 'processing'
                 and (r.claimed_at is null or r.claimed_at < now() - p_lease))
           )
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
  'Atomically claim up to p_limit erasure requests for one erasure-job pass (#717): every ''requested'' and ''retained'' (#735) row, plus every ''processing'' row whose claim is older than p_lease or absent, at most one per member. ''failed'', ''partial'' and ''done'' are never re-claimed. Returns the claimed rows with the status already flipped to ''processing'' and the stamp it took, which the caller MUST fence its terminal write on — a pass whose lease expired mid-cascade would otherwise write over a row a later pass now owns. p_lease must exceed the edge-function wall clock — 150s free, 400s paid (https://supabase.com/docs/guides/functions/limits) — or a live pass re-claims its own rows; the 15-minute default is 2.25x the paid ceiling. Two overlapping calls never return the same row, and never return two rows of one member; a caller that loses the race for a member simply does not see them this pass. To release a stuck lease by hand, null the row''s claimed_at (RELEASE-RUNBOOK §7.5) — do NOT pass a zero lease, which re-stamps the rows and hides them from the pass you are about to invoke. Service-role only.';

revoke execute on function public.claim_erasure_requests(int, interval) from public, anon, authenticated;
grant execute on function public.claim_erasure_requests(int, interval) to service_role;
